/**
 * Event listener plugin
 * Subscribes to crouton:mutation hooks and tracks events
 * Uses Option 1 error handling: visible toasts in dev, silent console in prod
 */

export default defineNuxtPlugin((nuxtApp) => {
  const { track } = useCroutonEventTracker()
  const config = useRuntimeConfig()
  const notify = useNotify()

  // Health tracking state
  const health = useState('crouton-events-health', () => ({
    total: 0,
    failed: 0,
    lastError: null as string | null,
    lastErrorTime: null as Date | null
  }))

  // Subscribe to the crouton:mutation hook
  nuxtApp.hooks.hook('crouton:mutation', async (event) => {
    // Only track from client side
    if (!import.meta.client) return

    // Only create/update/delete are recorded as events (move/reorder are not)
    if (event.operation !== 'create' && event.operation !== 'update' && event.operation !== 'delete') return

    // Skip if tracking is disabled
    if (!config.public.croutonEvents?.enabled) return

    // Increment total attempts
    health.value.total++

    // Track the event
    try {
      await track({
        operation: event.operation,
        collection: event.collection,
        itemId: event.itemId,
        itemIds: event.itemIds,
        data: event.data,
        updates: event.updates,
        result: event.result,
        beforeData: event.beforeData
      })
    } catch (err: any) {
      // Update health stats
      health.value.failed++
      health.value.lastError = err.message || 'Unknown error'
      health.value.lastErrorTime = new Date()

      // Always log to console
      if (config.public.croutonEvents.errorHandling?.logToConsole) {
        console.error('[CroutonEvents] Tracking failed:', err)
      }

      // Development mode: Show visible warning
      if (import.meta.dev) {
        notify.warning('Event tracking failed', {
          description: err.message || 'Failed to track event',
          target: 'toast',
        })
      }
      // Production mode: Silent (already logged to console)
    }
  })
})
