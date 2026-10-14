/**
 * Metrics Endpoint
 *
 * GET /api/metrics
 *
 * Exposes performance metrics for monitoring and observability.
 *
 * Returns:
 * - Operation statistics (durations, counts, success rates)
 * - System-wide metrics
 * - Top slowest operations
 * - Error rate summary
 *
 * Access control: This endpoint should be protected in production
 * (e.g., API key, IP whitelist, or internal network only)
 */

import { metricsCollector } from '../../utils/metrics'
import { logger } from '../../utils/logger'

/**
 * Metrics response format
 */
interface MetricsResponse {
  timestamp: string
  summary: {
    totalOperations: number
    totalDataPoints: number
    averageSuccessRate: number
  }
  operations: ReturnType<typeof metricsCollector.getAllStats>
  topSlowest: Array<{
    operation: string
    avgDuration: number
    p95Duration: number
    count: number
  }>
  topErrors: Array<{
    operation: string
    errorRate: number
    failureCount: number
    count: number
  }>
}

/**
 * Metrics endpoint handler
 */
export default defineEventHandler(async (event): Promise<MetricsResponse> => {
  await requireAuth(event)

  logger.info('Metrics requested')

  // Get all stats
  const allStats = metricsCollector.getAllStats()

  // Calculate summary
  const operations = Object.values(allStats)
  const totalSuccessRate = operations.length > 0
    ? Math.round(operations.reduce((sum, op) => sum + op.successRate, 0) / operations.length)
    : 0

  const summary = {
    totalOperations: metricsCollector.getOperationCount(),
    totalDataPoints: metricsCollector.getTotalDataPoints(),
    averageSuccessRate: totalSuccessRate,
  }

  // Top 10 slowest operations
  const topSlowest = Object.entries(allStats)
    .map(([operation, stats]) => ({
      operation,
      avgDuration: stats.durations.avg,
      p95Duration: stats.durations.p95,
      count: stats.count,
    }))
    .sort((a, b) => b.p95Duration - a.p95Duration)
    .slice(0, 10)

  // Top 10 operations with highest error rates
  const topErrors = Object.entries(allStats)
    .filter(([_, stats]) => stats.failureCount > 0)
    .map(([operation, stats]) => ({
      operation,
      errorRate: 100 - stats.successRate,
      failureCount: stats.failureCount,
      count: stats.count,
    }))
    .sort((a, b) => b.errorRate - a.errorRate)
    .slice(0, 10)

  const response: MetricsResponse = {
    timestamp: new Date().toISOString(),
    summary,
    operations: allStats,
    topSlowest,
    topErrors,
  }

  return response
})