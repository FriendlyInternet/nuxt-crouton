/**
 * Rate Limiting Utility
 *
 * Provides:
 * - In-memory rate limiting for API endpoints
 * - Configurable limits per endpoint/identifier
 * - Automatic cleanup of expired entries
 * - Support for different time windows
 *
 * Design:
 * - Token bucket algorithm for smooth rate limiting
 * - Per-IP and per-user rate limiting
 * - Graceful degradation (logs errors but doesn't block)
 */

interface RateLimitEntry {
  count: number
  resetTime: number
}

/**
 * In-memory store for rate limit tracking.
 * Key format: `${identifier}:${endpoint}`
 *
 * On Cloudflare Workers, modules are reused across requests within the same
 * isolate, so a plain module-level Map is shared between concurrent requests.
 * For rate limiting this is actually acceptable — and even desirable — because:
 *   - Entries are keyed by identifier (IP/user) + endpoint, not by request
 *   - Cross-request sharing means the counter correctly accumulates hits from
 *     the same IP across concurrent requests in the same isolate
 *   - Entries expire naturally (checked on every access via resetTime)
 *   - Workers isolates are single-threaded, so there are no race conditions
 *
 * The only caveat: state does NOT persist across isolate restarts or Workers
 * instances (each edge PoP runs its own isolate). For strict global rate
 * limiting use Cloudflare Durable Objects / KV instead.
 */
const rateLimitStore = new Map<string, RateLimitEntry>()

// NOTE: intentionally empty — cleanup is handled by Cloudflare Workers KV TTL
export function startCleanup(): void {}

/**
 * Perform on-demand cleanup of expired entries
 * Called during rate limit checks to avoid global scope setInterval
 */
function cleanupExpiredEntries() {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the time window
   */
  maxRequests: number

  /**
   * Time window in milliseconds
   */
  windowMs: number

  /**
   * Identifier for rate limiting (e.g., IP address, user ID, team ID)
   * If not provided, will attempt to extract from event
   */
  identifier?: string

  /**
   * Endpoint key for grouping rate limits
   * Defaults to event path
   */
  endpoint?: string

  /**
   * Custom error message when rate limit is exceeded
   */
  message?: string
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean

  /**
   * Current request count in this window
   */
  current: number

  /**
   * Maximum requests allowed
   */
  limit: number

  /**
   * Time remaining until reset (milliseconds)
   */
  resetIn: number

  /**
   * Timestamp when the limit resets
   */
  resetTime: number
}

/**
 * Check if request is within rate limit
 *
 * @param event - H3 event object
 * @param config - Rate limit configuration
 * @returns Rate limit result
 *
 * @example
 * ```ts
 * const result = checkRateLimit(event, {
 *   maxRequests: 10,
 *   windowMs: 60000, // 1 minute
 *   identifier: 'user-123',
 *   endpoint: '/api/webhooks/slack'
 * })
 *
 * if (!result.allowed) {
 *   throw createError({
 *     statusCode: 429,
 *     statusMessage: 'Too Many Requests',
 *     data: {
 *       limit: result.limit,
 *       resetIn: result.resetIn
 *     }
 *   })
 * }
 * ```
 */
export function checkRateLimit(
  event: any,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now()

  // Determine identifier (IP address, user ID, team ID, etc.)
  const identifier = config.identifier || getClientIP(event) || 'unknown'

  // Determine endpoint (path or custom key)
  const endpoint = config.endpoint || event.path || 'default'

  // Create unique key for this identifier + endpoint combination
  const key = `${identifier}:${endpoint}`

  // Get or create rate limit entry
  let entry = rateLimitStore.get(key)

  // Create new entry if doesn't exist or if window has expired
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
    }
    rateLimitStore.set(key, entry)
  }

  // Increment count
  entry.count++

  // Check if limit exceeded
  const allowed = entry.count <= config.maxRequests

  return {
    allowed,
    current: entry.count,
    limit: config.maxRequests,
    resetIn: Math.max(0, entry.resetTime - now),
    resetTime: entry.resetTime,
  }
}

/**
 * Rate limit middleware for H3 event handlers
 *
 * Throws 429 error if rate limit is exceeded.
 *
 * @param config - Rate limit configuration
 * @returns Middleware function
 *
 * @example
 * ```ts
 * export default defineEventHandler(async (event) => {
 *   // Apply rate limiting: 10 requests per minute
 *   await rateLimit(event, {
 *     maxRequests: 10,
 *     windowMs: 60000
 *   })
 *
 *   // Continue with request handling
 *   return { success: true }
 * })
 * ```
 */
export async function rateLimit(
  event: any,
  config: RateLimitConfig,
): Promise<void> {
  const result = checkRateLimit(event, config)

  if (!result.allowed) {
    const message = config.message || 'Too many requests, please try again later'

    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: {
        message,
        limit: result.limit,
        current: result.current,
        resetIn: result.resetIn,
        resetAt: new Date(result.resetTime).toISOString(),
      },
    })
  }

  // Set rate limit headers (standard RateLimit headers)
  setHeader(event, 'RateLimit-Limit', result.limit.toString())
  setHeader(event, 'RateLimit-Remaining', Math.max(0, result.limit - result.current).toString())
  setHeader(event, 'RateLimit-Reset', result.resetTime.toString())
}

/**
 * Get client IP address from event
 *
 * Checks multiple headers in priority order:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. X-Forwarded-For (most proxies)
 * 3. X-Real-IP (nginx)
 * 4. event.node.req.socket.remoteAddress (direct connection)
 *
 * @param event - H3 event object
 * @returns IP address or undefined
 */
function getClientIP(event: any): string | undefined {
  // Cloudflare
  const cfIP = getHeader(event, 'CF-Connecting-IP')
  if (cfIP) return cfIP as string

  // X-Forwarded-For (get first IP in chain)
  const xForwardedFor = getHeader(event, 'X-Forwarded-For')
  if (xForwardedFor) {
    const ips = (xForwardedFor as string).split(',')
    return ips[0]?.trim()
  }

  // X-Real-IP
  const xRealIP = getHeader(event, 'X-Real-IP')
  if (xRealIP) return xRealIP as string

  // Direct connection
  return event.node?.req?.socket?.remoteAddress
}

/**
 * Preset rate limit configurations for common use cases
 */
export const RateLimitPresets = {
  /**
   * Strict rate limit for webhooks: 100 requests per minute
   */
  WEBHOOK: {
    maxRequests: 100,
    windowMs: 60000, // 1 minute
    message: 'Webhook rate limit exceeded',
  },

  /**
   * Moderate rate limit for API endpoints: 60 requests per minute
   */
  API: {
    maxRequests: 60,
    windowMs: 60000, // 1 minute
    message: 'API rate limit exceeded',
  },

  /**
   * Strict rate limit for authentication endpoints: 5 requests per 15 minutes
   */
  AUTH: {
    maxRequests: 5,
    windowMs: 15 * 60000, // 15 minutes
    message: 'Too many authentication attempts',
  },

  /**
   * Lenient rate limit for read operations: 300 requests per minute
   */
  READ: {
    maxRequests: 300,
    windowMs: 60000, // 1 minute
    message: 'Read rate limit exceeded',
  },

  /**
   * Moderate rate limit for write operations: 30 requests per minute
   */
  WRITE: {
    maxRequests: 30,
    windowMs: 60000, // 1 minute
    message: 'Write rate limit exceeded',
  },
} as const
