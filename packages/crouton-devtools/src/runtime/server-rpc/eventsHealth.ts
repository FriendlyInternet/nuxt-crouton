import { defineEventHandler } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { asc, count, desc, gte } from 'drizzle-orm'

/**
 * Get events health statistics
 * GET /__nuxt_crouton_devtools/api/events/health
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()

  // Check if events package is available
  if (!config.croutonDevtools?.hasEventsPackage) {
    return {
      success: false,
      available: false,
      message: 'Events package not installed'
    }
  }

  try {
    const db = useDB()
    let totalEvents = 0
    let todayEvents = 0
    let thisWeekEvents = 0
    let collections: string[] = []
    const byOperation: Record<string, number> = { create: 0, update: 0, delete: 0 }
    const byCollection: Record<string, number> = {}
    let oldestEvent: Date | null = null
    let newestEvent: Date | null = null

    try {
      // Try to get basic stats from the events table
      const possibleSchemas = [
        () => import('~~/layers/events/collections/collectionEvents/server/database/schema'),
        () => import('~~/collections/croutonEvents/server/database/schema'),
        () => import('~~/server/database/schema').then(m => ({ eventsCollectionEvents: m.croutonEvents }))
      ]

      for (const schemaLoader of possibleSchemas) {
        try {
          const schema = await schemaLoader() as any
          const table = schema.eventsCollectionEvents || schema.collectionEvents || schema.croutonEvents

          if (table) {
            const now = new Date()
            const today = new Date(now)
            today.setHours(0, 0, 0, 0)
            const weekAgo = new Date(now)
            weekAgo.setDate(weekAgo.getDate() - 7)

            // Run all aggregates in parallel — SQL does the heavy lifting
            const [
              totalRows,
              todayRows,
              weekRows,
              oldestRows,
              newestRows,
              operationGroups,
              collectionGroups
            ] = await Promise.all([
              db.select({ n: count() }).from(table),
              db.select({ n: count() }).from(table).where(gte(table.timestamp, today)),
              db.select({ n: count() }).from(table).where(gte(table.timestamp, weekAgo)),
              db.select({ ts: table.timestamp }).from(table).orderBy(asc(table.timestamp)).limit(1),
              db.select({ ts: table.timestamp }).from(table).orderBy(desc(table.timestamp)).limit(1),
              db.select({ operation: table.operation, n: count() }).from(table).groupBy(table.operation),
              db.select({ collectionName: table.collectionName, n: count() }).from(table).groupBy(table.collectionName)
            ])

            totalEvents = Number(totalRows[0]?.n ?? 0)
            todayEvents = Number(todayRows[0]?.n ?? 0)
            thisWeekEvents = Number(weekRows[0]?.n ?? 0)
            oldestEvent = oldestRows[0]?.ts ? new Date(oldestRows[0].ts as any) : null
            newestEvent = newestRows[0]?.ts ? new Date(newestRows[0].ts as any) : null

            for (const row of operationGroups as Array<{ operation: string, n: number }>) {
              if (row.operation && Object.prototype.hasOwnProperty.call(byOperation, row.operation)) {
                byOperation[row.operation] = Number(row.n)
              }
            }

            for (const row of collectionGroups as Array<{ collectionName: string, n: number }>) {
              if (row.collectionName) {
                byCollection[row.collectionName] = Number(row.n)
              }
            }

            collections = Object.keys(byCollection).sort()

            break
          }
        } catch {
          continue
        }
      }
    } catch (err) {
      console.warn('[DevTools Events Health] Could not query events:', err)
    }

    // Determine health status based on recent activity
    let status: 'healthy' | 'warning' | 'inactive' = 'healthy'
    if (totalEvents === 0) {
      status = 'inactive'
    } else if (todayEvents === 0 && thisWeekEvents === 0) {
      status = 'warning'
    }

    return {
      success: true,
      available: true,
      data: {
        status,
        totalEvents,
        todayEvents,
        thisWeekEvents,
        collectionsTracked: collections.length,
        collections,
        byOperation,
        byCollection,
        oldestEvent: oldestEvent?.toISOString() || null,
        newestEvent: newestEvent?.toISOString() || null,
        // Success rate is 100% for tracked events (failures would be untracked)
        successRate: 100,
        failedEvents: 0
      }
    }
  } catch (err) {
    return {
      success: false,
      available: true,
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
})
