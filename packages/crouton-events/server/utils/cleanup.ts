/**
 * Event cleanup utility
 * Removes old events based on retention policy
 * Can be called via API endpoint or scheduled task (NuxtHub)
 */

import { lt, inArray, sql } from 'drizzle-orm'
import { croutonEvents } from '../database/schema'

interface CleanupOptions {
  retentionDays?: number
  maxEvents?: number
  dryRun?: boolean
}

interface CleanupResult {
  deletedCount: number
  oldestRemaining: Date | null
  totalRemaining: number
}

/**
 * Clean up old events based on retention policy
 */
export async function cleanupOldEvents(options: CleanupOptions = {}): Promise<CleanupResult> {
  const config = useRuntimeConfig()
  const db = useDB()

  // Get retention settings from config or use defaults
  const retentionDays = options.retentionDays || config.public.croutonEvents?.retention?.days || 90
  const maxEvents = options.maxEvents || config.public.croutonEvents?.retention?.maxEvents || 100000
  const dryRun = options.dryRun || false

  // Calculate cutoff date
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)

  console.log('[CroutonEvents Cleanup] Starting cleanup...')
  console.log(`  Retention: ${retentionDays} days (cutoff: ${cutoffDate.toISOString()})`)
  console.log(`  Max events: ${maxEvents}`)
  console.log(`  Dry run: ${dryRun}`)

  try {
    // Count total events before cleanup
    const totalBefore = await db
      .select({ count: sql<number>`count(*)` })
      .from(croutonEvents)
      .then((rows: { count: number }[]) => rows[0]?.count || 0)

    console.log(`  Total events before: ${totalBefore}`)

    // Count events to be deleted by date
    const toDeleteByDate = await db
      .select({ count: sql<number>`count(*)` })
      .from(croutonEvents)
      .where(lt(croutonEvents.timestamp, cutoffDate))
      .then((rows: { count: number }[]) => rows[0]?.count || 0)

    console.log(`  Events older than ${retentionDays} days: ${toDeleteByDate}`)

    // Delete old events (by date)
    let deletedByDate = 0
    if (!dryRun && toDeleteByDate > 0) {
      await db
        .delete(croutonEvents)
        .where(lt(croutonEvents.timestamp, cutoffDate))

      deletedByDate = toDeleteByDate // Drizzle doesn't return affected rows directly
      console.log(`  ✓ Deleted ${deletedByDate} events by date`)
    }

    // Check if we still exceed maxEvents
    const totalAfterDate = totalBefore - deletedByDate
    let deletedByCount = 0

    if (totalAfterDate > maxEvents) {
      const excessCount = totalAfterDate - maxEvents
      console.log(`  Events exceed max (${totalAfterDate} > ${maxEvents}), need to delete ${excessCount} more`)

      if (!dryRun) {
        // Delete oldest events until we're under maxEvents.
        // Cleanup runs in bounded batches (max 5000 per run) to avoid a full-table
        // sort + scan on large tables which would cause DoS under load. If more than
        // 5000 excess events exist the next scheduled cleanup run will continue.
        const batchLimit = Math.min(excessCount, 5000)

        // Get IDs of oldest events to delete
        const oldestEvents = await db
          .select({ id: croutonEvents.id })
          .from(croutonEvents)
          .orderBy(croutonEvents.timestamp)
          .limit(batchLimit)

        if (oldestEvents.length > 0) {
          // Delete in batches to avoid hitting query limits
          const batchSize = 1000
          for (let i = 0; i < oldestEvents.length; i += batchSize) {
            const batch = oldestEvents.slice(i, i + batchSize)
            const ids = batch.map((e: { id: string }) => e.id)

            await db
              .delete(croutonEvents)
              .where(inArray(croutonEvents.id, ids))
          }

          deletedByCount = oldestEvents.length
          console.log(`  ✓ Deleted ${deletedByCount} events by count limit`)
        }
      }
    }

    const totalDeleted = deletedByDate + deletedByCount
    const totalAfter = totalBefore - totalDeleted

    // Get oldest remaining event
    const oldestRemaining = await db
      .select({ timestamp: croutonEvents.timestamp })
      .from(croutonEvents)
      .orderBy(croutonEvents.timestamp)
      .limit(1)
      .then((rows: { timestamp: Date }[]) => rows[0]?.timestamp || null)

    console.log(`  Total deleted: ${totalDeleted}`)
    console.log(`  Total remaining: ${totalAfter}`)
    console.log(`  Oldest remaining: ${oldestRemaining?.toISOString() || 'N/A'}`)
    console.log('[CroutonEvents Cleanup] Complete!')

    return {
      deletedCount: totalDeleted,
      oldestRemaining,
      totalRemaining: totalAfter
    }
  } catch (error) {
    console.error('[CroutonEvents Cleanup] Error:', error)
    throw error
  }
}
