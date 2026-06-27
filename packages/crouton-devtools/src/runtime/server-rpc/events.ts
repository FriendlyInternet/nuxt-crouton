import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Get persisted events from the events package
 * Only returns data when nuxt-crouton-events is installed
 * GET /__nuxt_crouton_devtools/api/events?teamId=X&collection=users&operation=create&itemId=abc123&limit=50
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()

  // Check if events package is available
  if (!config.croutonDevtools?.hasEventsPackage) {
    return {
      success: false,
      available: false,
      message: 'Events package not installed',
      data: []
    }
  }

  const query = getQuery(event)
  const teamId = query.teamId ? String(query.teamId) : undefined

  if (!teamId) {
    return {
      success: true,
      available: true,
      data: [],
      count: 0,
      filters: {}
    }
  }

  // Build filters to pass to the events API
  const filters: Record<string, string> = {}
  if (query.collection) filters.collectionName = String(query.collection)
  if (query.operation) filters.operation = String(query.operation)
  if (query.userId) filters.userId = String(query.userId)
  if (query.itemId) filters.itemId = String(query.itemId)
  if (query.dateFrom) filters.dateFrom = String(query.dateFrom)
  if (query.dateTo) filters.dateTo = String(query.dateTo)

  const limit = query.limit ? Number.parseInt(String(query.limit), 10) : 50

  try {
    const eventsData = await $fetch<any[]>(`/api/teams/${teamId}/crouton-events`, {
      query: { ...filters, pageSize: limit }
    })

    return {
      success: true,
      available: true,
      data: eventsData ?? [],
      count: eventsData?.length ?? 0,
      filters
    }
  } catch (err) {
    return {
      success: false,
      available: true,
      error: err instanceof Error ? err.message : 'Unknown error',
      data: []
    }
  }
})
