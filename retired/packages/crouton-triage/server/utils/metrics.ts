/**
 * Performance Metrics Utility
 *
 * Tracks performance metrics for key operations in the system.
 * Provides simple in-memory metrics collection for monitoring.
 *
 * Features:
 * - Track operation durations (min, max, avg, p95, p99)
 * - Track operation counts (success, failure)
 * - Track error rates
 * - Automatic metric aggregation
 * - Metric export for monitoring dashboards
 *
 * Usage:
 * ```typescript
 * import { metrics } from '~/server/utils/metrics'
 *
 * const timer = metrics.start('ai.generate_summary')
 * // ... operation ...
 * timer.end({ success: true, tokens: 500 })
 *
 * // Get metrics for monitoring
 * const stats = metrics.getStats()
 * ```
 */

import { logger } from './logger'

/**
 * Metric data point
 */
interface MetricDataPoint {
  duration: number
  timestamp: number
  success: boolean
  metadata?: Record<string, any>
}

/**
 * Aggregated metric statistics
 */
interface MetricStats {
  count: number
  successCount: number
  failureCount: number
  successRate: number
  durations: {
    min: number
    max: number
    avg: number
    p95: number
    p99: number
  }
  lastUpdated: string
}

/**
 * All metrics
 */
interface AllMetrics {
  [operation: string]: MetricStats
}

/**
 * Timer interface
 */
interface MetricTimer {
  end: (metadata?: { success?: boolean; [key: string]: any }) => number
}

/**
 * Maximum data points to keep per operation (prevent memory bloat)
 */
const MAX_DATA_POINTS = 1000

/**
 * In-memory storage for metrics.
 *
 * On Cloudflare Workers, modules are reused across requests, so a plain
 * module-level Map would accumulate data from all concurrent requests in the
 * same isolate. We intentionally keep a single Map here because:
 *   - Metrics are additive/append-only (never read back to influence a request)
 *   - Cross-request aggregation is the desired behaviour for an in-process
 *     metrics store (seeing p95 across all recent requests is useful)
 *   - The Map is bounded by MAX_DATA_POINTS per operation key, preventing
 *     unbounded memory growth
 *
 * If strict per-request isolation is required in future, migrate to Nitro
 * storage (useStorage) backed by KV/Durable Objects.
 *
 * In production, consider using Redis or a time-series database instead.
 */
const metrics = new Map<string, MetricDataPoint[]>()

/**
 * Percentile calculation helper
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)] ?? 0
}

/**
 * Calculate statistics from data points
 */
function calculateStats(dataPoints: MetricDataPoint[]): MetricStats {
  if (dataPoints.length === 0) {
    return {
      count: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      durations: { min: 0, max: 0, avg: 0, p95: 0, p99: 0 },
      lastUpdated: new Date().toISOString(),
    }
  }

  const durations = dataPoints.map(d => d.duration)
  const successCount = dataPoints.filter(d => d.success).length
  const failureCount = dataPoints.length - successCount

  return {
    count: dataPoints.length,
    successCount,
    failureCount,
    successRate: Math.round((successCount / dataPoints.length) * 100),
    durations: {
      min: Math.min(...durations),
      max: Math.max(...durations),
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
    },
    lastUpdated: new Date().toISOString(),
  }
}

/**
 * Record a metric data point
 */
function record(operation: string, duration: number, success: boolean, metadata?: Record<string, any>): void {
  const dataPoint: MetricDataPoint = {
    duration,
    timestamp: Date.now(),
    success,
    metadata,
  }

  // Get or create metrics array for this operation
  let dataPoints = metrics.get(operation)
  if (!dataPoints) {
    dataPoints = []
    metrics.set(operation, dataPoints)
  }

  // Add new data point
  dataPoints.push(dataPoint)

  // Keep only the last MAX_DATA_POINTS
  if (dataPoints.length > MAX_DATA_POINTS) {
    dataPoints.shift()
  }

  // Log slow operations (>5s)
  if (duration > 5000) {
    logger.warn(`Slow operation detected: ${operation}`, {
      duration,
      success,
      ...metadata,
    })
  }
}

/**
 * Metrics collection API
 */
export const metricsCollector = {
  /**
   * Start timing an operation
   */
  start(operation: string): MetricTimer {
    const startTime = Date.now()

    return {
      end(metadata?: { success?: boolean; [key: string]: any }): number {
        const duration = Date.now() - startTime
        const success = metadata?.success !== false // Default to true
        const { success: _success, ...otherMetadata } = (metadata || {}) as Record<string, any>

        record(operation, duration, success, Object.keys(otherMetadata).length > 0 ? otherMetadata : undefined)

        return duration
      },
    }
  },

  /**
   * Record a metric without timing (for external durations)
   */
  record(operation: string, duration: number, success: boolean = true, metadata?: Record<string, any>): void {
    record(operation, duration, success, metadata)
  },

  /**
   * Get statistics for a specific operation
   */
  getStats(operation: string): MetricStats | undefined {
    const dataPoints = metrics.get(operation)
    if (!dataPoints) return undefined

    return calculateStats(dataPoints)
  },

  /**
   * Get statistics for all operations
   */
  getAllStats(): AllMetrics {
    const allStats: AllMetrics = {}

    metrics.forEach((dataPoints, operation) => {
      allStats[operation] = calculateStats(dataPoints)
    })

    return allStats
  },

  /**
   * Clear metrics for an operation
   */
  clear(operation: string): void {
    metrics.delete(operation)
  },

  /**
   * Clear all metrics
   */
  clearAll(): void {
    metrics.clear()
  },

  /**
   * Get total number of operations tracked
   */
  getOperationCount(): number {
    return metrics.size
  },

  /**
   * Get total data points across all operations
   */
  getTotalDataPoints(): number {
    let total = 0
    metrics.forEach(dataPoints => {
      total += dataPoints.length
    })
    return total
  },
}

/**
 * Common operation names for consistency
 */
export const METRICS = {
  // Webhook processing
  WEBHOOK_SLACK: 'webhook.slack',
  WEBHOOK_MAILGUN: 'webhook.mailgun',

  // Discussion processing stages
  PROCESS_VALIDATION: 'process.validation',
  PROCESS_CONFIG_LOAD: 'process.config_load',
  PROCESS_THREAD_BUILD: 'process.thread_build',
  PROCESS_AI_ANALYSIS: 'process.ai_analysis',
  PROCESS_TASK_CREATE: 'process.task_create',
  PROCESS_NOTIFICATION: 'process.notification',
  PROCESS_FULL: 'process.full',

  // AI operations
  AI_GENERATE_SUMMARY: 'ai.generate_summary',
  AI_DETECT_TASKS: 'ai.detect_tasks',
  AI_CACHE_HIT: 'ai.cache_hit',
  AI_CACHE_MISS: 'ai.cache_miss',

  // Notion operations
  NOTION_CREATE_TASK: 'notion.create_task',
  NOTION_CREATE_TASKS: 'notion.create_tasks',
  NOTION_UPDATE_STATUS: 'notion.update_status',

  // Adapter operations
  ADAPTER_FETCH_THREAD: 'adapter.fetch_thread',
  ADAPTER_POST_REPLY: 'adapter.post_reply',
  ADAPTER_UPDATE_STATUS: 'adapter.update_status',

  // Database operations
  DB_CREATE_DISCUSSION: 'db.create_discussion',
  DB_CREATE_JOB: 'db.create_job',
  DB_CREATE_TASK: 'db.create_task',
  DB_UPDATE_DISCUSSION: 'db.update_discussion',
  DB_UPDATE_JOB: 'db.update_job',
}

/**
 * Export for use in other modules
 */
export type MetricsCollector = typeof metricsCollector