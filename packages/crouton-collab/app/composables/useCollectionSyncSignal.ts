import * as Y from 'yjs'
import { ref, computed, watch, shallowRef, toValue, type Ref, type ComputedRef, type MaybeRef } from 'vue'
import { useCollabConnection, type UseCollabConnectionReturn } from './useCollabConnection'
import { useDebounceFn, tryOnUnmounted } from '@vueuse/core'

export interface UseCollectionSyncSignalOptions {
  /**
   * Team ID for scoping the sync room.
   * Can be a string or a ref that may be undefined initially.
   */
  teamId: MaybeRef<string | undefined>

  /**
   * Debounce delay for the onCollectionChanged callback.
   * Prevents rapid-fire refreshes when multiple changes occur quickly.
   * @default 300
   */
  debounceMs?: number

  /**
   * Callback fired when a remote change is detected for a collection.
   * Use this to refresh collection queries.
   */
  onCollectionChanged?: (collection: string, version: number) => void

  /**
   * Auto-connect when teamId becomes available.
   * @default true
   */
  autoConnect?: boolean
}

export interface UseCollectionSyncSignalReturn {
  /**
   * Signal that a collection has changed (increments version in Y.Map).
   * Call this after successful mutations.
   */
  signalChange: (collection: string) => void

  /**
   * Current version numbers for all collections.
   * Keys are collection names, values are version counters.
   */
  versions: Ref<Record<string, number>>

  /**
   * Whether the sync connection is established.
   */
  connected: ComputedRef<boolean>

  /**
   * Whether the initial sync is complete.
   */
  synced: ComputedRef<boolean>

  /**
   * Manually connect to the sync room.
   */
  connect: () => void

  /**
   * Manually disconnect from the sync room.
   */
  disconnect: () => void
}

/**
 * Real-time collection sync signals via Yjs.
 *
 * This composable uses the existing Yjs collaboration infrastructure to
 * broadcast collection version changes across all connected clients.
 * When a mutation occurs, the local client increments a version counter
 * in a shared Y.Map. Other clients observe this change and trigger a
 * debounced refresh of their collection queries.
 *
 * Architecture:
 * - Each team has a sync room: `team:{teamId}:sync`
 * - Y.Map stores: `{ [collectionName]: versionNumber }`
 * - Version increments are automatically synced via CollabRoom
 *
 * @example
 * ```ts
 * const { signalChange, connected } = useCollectionSyncSignal({
 *   teamId: computed(() => currentTeam.value?.id),
 *   debounceMs: 300,
 *   onCollectionChanged: async (collection) => {
 *     // Refresh all cache keys for this collection
 *     await refreshNuxtData(`collection:${collection}:*`)
 *   }
 * })
 *
 * // After a successful mutation
 * await mutation.create(data)
 * signalChange('products')
 * ```
 */
export function useCollectionSyncSignal(
  options: UseCollectionSyncSignalOptions
): UseCollectionSyncSignalReturn {
  const {
    teamId,
    debounceMs = 300,
    onCollectionChanged,
    autoConnect = true
  } = options

  // Track if we're on the server (skip WebSocket setup)
  const isServer = typeof window === 'undefined'

  // Reactive state
  const versions = ref<Record<string, number>>({})
  // Use shallowRef to preserve computed refs inside the connection object
  const connectionRef = shallowRef<UseCollabConnectionReturn | null>(null)

  // Track which version changes originated locally (to skip callbacks)
  const localVersions = new Map<string, number>()

  // Debounced callback for remote changes
  const debouncedCallback = useDebounceFn((collection: string, version: number) => {
    if (onCollectionChanged) {
      onCollectionChanged(collection, version)
    }
  }, debounceMs)

  // Y.Map reference (set when connected)
  let ymap: Y.Map<number> | null = null

  /**
   * Build the room ID from team ID
   */
  function getRoomId(id: string): string {
    return `team:${id}:sync`
  }

  /**
   * Initialize connection when team ID is available
   */
  function initConnection(id: string): void {
    if (isServer) return
    if (connectionRef.value) {
      // Already connected
      return
    }

    const roomId = getRoomId(id)

    // Create connection using low-level composable
    // Note: autoConnect uses onMounted which doesn't work in plugin context
    const connection = useCollabConnection({
      roomId,
      roomType: 'sync',
      teamId: id,
      autoConnect: false  // We'll connect manually
    })

    connectionRef.value = connection

    // Get Y.Map from the document
    ymap = connection.ydoc.getMap<number>('versions')

    // Connect manually (works in plugin context)
    connection.connect()

    // Observe Y.Map changes
    ymap.observe((event) => {
      // Update reactive versions
      const result: Record<string, number> = {}
      ymap!.forEach((value, key) => {
        result[key] = value
      })
      versions.value = result

      // Check for remote changes (skip local ones)
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add' || change.action === 'update') {
          const newVersion = ymap!.get(key)
          if (newVersion !== undefined) {
            const localVersion = localVersions.get(key)

            // If this version matches what we just set locally, skip callback
            if (localVersion === newVersion) {
              // Clear local tracking - next change will trigger callback
              localVersions.delete(key)
              return
            }

            // Remote change - trigger debounced callback
            debouncedCallback(key, newVersion)
          }
        }
      })
    })

    // Initialize with current values
    const initialData: Record<string, number> = {}
    ymap.forEach((value, key) => {
      initialData[key] = value
    })
    versions.value = initialData
  }

  /**
   * Signal that a collection has changed
   */
  function signalChange(collection: string): void {
    if (!ymap) {
      console.warn('[useCollectionSyncSignal] Not connected - cannot signal change')
      return
    }

    const currentVersion = ymap.get(collection) ?? 0
    const newVersion = currentVersion + 1

    // Track that this is a local change
    localVersions.set(collection, newVersion)

    // Update Y.Map (will sync to all clients)
    ymap.set(collection, newVersion)
  }

  /**
   * Manual connect
   */
  function connect(): void {
    const id = toValue(teamId)
    if (id) {
      initConnection(id)
    }
  }

  /**
   * Manual disconnect
   */
  function disconnect(): void {
    if (connectionRef.value) {
      connectionRef.value.disconnect()
      connectionRef.value = null
      ymap = null
      localVersions.clear()
    }
  }

  // Watch for team ID changes
  watch(
    () => toValue(teamId),
    (newId, oldId) => {
      if (newId && newId !== oldId && autoConnect) {
        // Disconnect from old room if switching teams
        if (oldId && connectionRef.value) {
          disconnect()
        }
        // Connect to new room
        initConnection(newId)
      } else if (!newId && connectionRef.value) {
        // Team ID removed - disconnect
        disconnect()
      }
    },
    { immediate: true }
  )

  // Cleanup on unmount
  tryOnUnmounted(() => {
    disconnect()
  })

  return {
    signalChange,
    versions,
    connected: computed(() => connectionRef.value?.connected.value ?? false),
    synced: computed(() => connectionRef.value?.synced.value ?? false),
    connect,
    disconnect
  }
}
