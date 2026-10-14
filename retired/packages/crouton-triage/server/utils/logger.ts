/**
 * Structured Logger Utility
 *
 * Provides centralized, structured logging with different log levels,
 * contextual information, and proper formatting for production environments.
 *
 * Features:
 * - Multiple log levels (debug, info, warn, error)
 * - Structured JSON output for production
 * - Pretty-printed output for development
 * - Automatic context enrichment (timestamp, environment, etc.)
 * - Performance timing helpers
 * - Error serialization with stack traces
 *
 * Usage:
 * ```typescript
 * import { logger } from '~/server/utils/logger'
 *
 * logger.info('User logged in', { userId: '123', ip: '1.2.3.4' })
 * logger.error('API call failed', error, { endpoint: '/api/users' })
 *
 * const timer = logger.startTimer()
 * // ... operation ...
 * timer.end('Operation completed')
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogContext {
  [key: string]: any
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    message: string
    stack?: string
    name?: string
  }
  duration?: number
}

/**
 * Logger configuration
 */
const config = {
  // Minimum log level to output (can be overridden by LOG_LEVEL env var)
  // Production default is 'warn' to reduce noise
  minLevel: (process.env.LOG_LEVEL as LogLevel) || (process.env.NODE_ENV === 'production' ? 'warn' : 'info'),

  // Pretty print in development, JSON in production
  pretty: process.env.NODE_ENV !== 'production',

  // Include stack traces in error logs
  includeStackTrace: true,

  // Maximum size of context objects in production (bytes)
  maxContextSize: 1024, // 1KB limit per log entry context

  // Maximum string length for individual context values
  maxStringLength: 200,
}

/**
 * Log level priority for filtering
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * ANSI color codes for pretty printing
 */
const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  timestamp: '\x1b[90m', // Gray
  context: '\x1b[35m', // Magenta
}

/**
 * Check if a log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[config.minLevel]
}

/**
 * Format timestamp for display
 */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * Serialize an error object for logging
 */
function serializeError(error: any): LogEntry['error'] {
  if (!error) return undefined

  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: config.includeStackTrace ? error.stack : undefined,
  }
}

/**
 * Truncate string to maximum length
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}

/**
 * Sanitize context object to prevent excessive log sizes
 * - Truncates long strings
 * - Limits object depth
 * - Removes circular references
 * - Estimates total size
 */
function sanitizeContext(context?: LogContext): LogContext | undefined {
  if (!context || Object.keys(context).length === 0) return undefined

  // In development, allow more verbose logging
  if (config.pretty) {
    return sanitizeContextHelper(context, 3)
  }

  // In production, be more aggressive with sanitization
  const sanitized = sanitizeContextHelper(context, 2)
  const serialized = JSON.stringify(sanitized)

  // If still too large, truncate individual values further
  if (serialized.length > config.maxContextSize) {
    return sanitizeContextHelper(context, 1, config.maxStringLength / 2)
  }

  return sanitized
}

/**
 * Helper to recursively sanitize context objects
 */
function sanitizeContextHelper(obj: any, maxDepth: number, maxStrLen?: number): any {
  const maxStringLength = maxStrLen || config.maxStringLength

  if (maxDepth === 0) return '[Object]'

  if (obj === null || obj === undefined) return obj

  // Handle primitive types
  if (typeof obj === 'string') {
    return truncateString(obj, maxStringLength)
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    // Limit array size in production
    const limit = config.pretty ? 100 : 10
    const limited = obj.slice(0, limit)
    return limited.map(item => sanitizeContextHelper(item, maxDepth - 1, maxStrLen))
  }

  // Handle objects
  if (typeof obj === 'object') {
    const result: any = {}
    let keyCount = 0
    const maxKeys = config.pretty ? 50 : 20

    for (const [key, value] of Object.entries(obj)) {
      if (keyCount++ >= maxKeys) {
        result['...'] = `${Object.keys(obj).length - maxKeys} more keys`
        break
      }

      // Skip functions
      if (typeof value === 'function') continue

      result[key] = sanitizeContextHelper(value, maxDepth - 1, maxStrLen)
    }

    return result
  }

  // Fallback for other types
  return String(obj).substring(0, maxStringLength)
}

/**
 * Format log entry for pretty printing (development)
 */
function formatPretty(entry: LogEntry): string {
  const color = COLORS[entry.level]
  const timestamp = `${COLORS.timestamp}${entry.timestamp}${COLORS.reset}`
  const level = `${color}[${entry.level.toUpperCase()}]${COLORS.reset}`

  let output = `${timestamp} ${level} ${entry.message}`

  // Add duration if present
  if (entry.duration !== undefined) {
    output += ` ${COLORS.context}(${entry.duration}ms)${COLORS.reset}`
  }

  // Add context if present
  if (entry.context && Object.keys(entry.context).length > 0) {
    output += `\n${COLORS.context}Context: ${JSON.stringify(entry.context, null, 2)}${COLORS.reset}`
  }

  // Add error details if present
  if (entry.error) {
    output += `\n${COLORS.error}Error: ${entry.error.name}: ${entry.error.message}${COLORS.reset}`
    if (entry.error.stack) {
      output += `\n${entry.error.stack}`
    }
  }

  return output
}

/**
 * Format log entry for JSON output (production)
 */
function formatJSON(entry: LogEntry): string {
  return JSON.stringify(entry)
}

/**
 * Core log function
 */
function log(level: LogLevel, message: string, error?: any, context?: LogContext, duration?: number): void {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message: truncateString(message, 500), // Prevent extremely long messages
    context: sanitizeContext(context),
    error: serializeError(error),
    duration,
  }

  const formatted = config.pretty ? formatPretty(entry) : formatJSON(entry)

  // Output to appropriate console method
  if (level === 'error') {
    console.error(formatted)
  } else if (level === 'warn') {
    console.warn(formatted)
  } else {
    console.log(formatted)
  }
}

/**
 * Timer for measuring operation duration
 */
export interface Timer {
  end: (message: string, context?: LogContext) => number
}

/**
 * Logger interface
 */
export const logger = {
  /**
   * Log debug message (verbose, only shown in development)
   */
  debug(message: string, context?: LogContext): void {
    log('debug', message, undefined, context)
  },

  /**
   * Log info message (general information)
   */
  info(message: string, context?: LogContext): void {
    log('info', message, undefined, context)
  },

  /**
   * Log warning message (non-critical issues)
   */
  warn(message: string, context?: LogContext): void {
    log('warn', message, undefined, context)
  },

  /**
   * Log error message with optional error object
   */
  error(message: string, error?: any, context?: LogContext): void {
    log('error', message, error, context)
  },

  /**
   * Start a timer for measuring operation duration
   * Returns a timer object with end() method
   */
  startTimer(): Timer {
    const start = Date.now()

    return {
      end(message: string, context?: LogContext): number {
        const duration = Date.now() - start
        log('info', message, undefined, context, duration)
        return duration
      },
    }
  },

  /**
   * Log API request
   */
  request(method: string, path: string, context?: LogContext): void {
    log('info', `${method} ${path}`, undefined, context)
  },

  /**
   * Log API response
   */
  response(method: string, path: string, statusCode: number, duration: number, context?: LogContext): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info'
    log(level, `${method} ${path} ${statusCode}`, undefined, context, duration)
  },

  /**
   * Log webhook event
   */
  webhook(source: string, event: string, context?: LogContext): void {
    log('info', `Webhook received: ${source} - ${event}`, undefined, context)
  },

  /**
   * Log processing stage
   */
  processing(stage: string, context?: LogContext): void {
    log('info', `Processing: ${stage}`, undefined, context)
  },
}

/**
 * Export type for use in other modules
 */
export type Logger = typeof logger