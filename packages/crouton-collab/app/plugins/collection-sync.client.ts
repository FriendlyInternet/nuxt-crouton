/**
 * Collection Sync Plugin (Client-only)
 *
 * Initializes real-time collection sync only when the app is opted in (`"collab": true`
 * deploy flag → `collabWorkerUrl`); same-host only in local dev (#3810).
 * This plugin:
 * 1. Watches for team context availability
 * 2. Establishes a Yjs sync room for the team
 * 3. Hooks into crouton:mutation to signal changes
 * 4. Refreshes collection caches when remote changes are detected
 *
 * Architecture:
 * - Uses useCollectionSyncSignal for Yjs-based version sync
 * - Hooks into crouton:mutation (fired by useCollectionMutation)
 * - Finds and refreshes all cache keys for changed collections
 *
 * The .client.ts suffix ensures this only runs on the client side.
 */
import { useCollectionSyncSignal } from '../composables/useCollectionSyncSignal'
import { isCollabEnabled } from '../composables/useCollabConnection'

export default defineNuxtPlugin((nuxtApp) => {
  // Not opted into live sync → no router watcher, no mutation hook, no socket (#3810)
  if (!isCollabEnabled(useRuntimeConfig().public.collabWorkerUrl, import.meta.env.DEV)) return

  // Track if sync is initialized to avoid duplicate setup
  let syncInitialized = false
  let signalChangeFn: ((collection: string) => void) | null = null

  /**
   * Initialize sync for a team
   */
  function initSync(teamId: string): void {
    if (syncInitialized) return
    syncInitialized = true

    const { signalChange } = useCollectionSyncSignal({
      teamId,
      debounceMs: 300,
      onCollectionChanged: async (collection: string) => {
        // Fire hook so pages with raw $fetch can also react to remote changes
        nuxtApp.callHook('crouton:remoteChange' as any, { collection })

        // List queries subscribe to crouton:remoteChange themselves (useCollectionQuery)

        // Also refresh individual item caches for this collection
        const itemPrefix = `collection-item:${collection}:`
        const itemKeys = Object.keys(nuxtApp.payload.data || {}).filter(key => key.startsWith(itemPrefix))

        if (itemKeys.length > 0) {
          await Promise.all(itemKeys.map(key => refreshNuxtData(key)))
        }
      }
    })

    signalChangeFn = signalChange
  }

  /**
   * Get team ID from route or context
   */
  function getTeamIdFromContext(): string | undefined {
    // Use useTeamContext() which resolves team ID from auth or route params
    try {
      const { teamId } = useTeamContext()
      if (teamId.value) {
        return teamId.value
      }
    } catch {
      // useTeamContext not available, that's fine
    }

    return undefined
  }

  // Watch for route changes to detect team context
  const router = useRouter()

  router.afterEach(() => {
    const teamId = getTeamIdFromContext()
    if (teamId && !syncInitialized) {
      initSync(teamId)
    }
  })

  // Also check immediately in case we're already on a team route
  const initialTeamId = getTeamIdFromContext()
  if (initialTeamId) {
    initSync(initialTeamId)
  }

  // Hook into crouton:mutation to signal changes
  nuxtApp.hook('crouton:mutation', (event: { collection: string }) => {
    if (signalChangeFn) {
      signalChangeFn(event.collection)
    }
  })
})
