/**
 * useFormCollabPresence - Auto-establish presence for CRUD form editing
 *
 * This composable watches for slideover state changes in useCrouton and
 * automatically establishes WebSocket presence when users are editing items.
 *
 * It is auto-initialized via the form-collab.client.ts plugin when
 * crouton-collab is installed.
 *
 * @example
 * // Usually auto-initialized by plugin, but can be used manually:
 * const { activeConnections, cleanup } = useFormCollabPresence()
 */
import { ref, watch, type Ref } from 'vue'
import { tryOnScopeDispose } from '@vueuse/core'
import type { CollabAwarenessState } from '../types/collab'
import { generateUserColor } from '../utils/avatar'
import { useCollabTeamId } from './useCollabTeamId'

export interface FormCollabConnection {
  stateId: string
  roomId: string
  roomType: string
  ws: WebSocket
}

export interface UseFormCollabPresenceReturn {
  /** Map of active WebSocket connections by state ID */
  activeConnections: Ref<Map<string, FormCollabConnection>>
  /** Manually clean up a specific connection */
  cleanupConnection: (stateId: string) => void
  /** Clean up all connections */
  cleanup: () => void
}

/**
 * Get current user for presence tracking
 * Falls back to anonymous user if auth is not available
 */
function getCurrentUser(): { id: string; name: string } {
  try {
    if (typeof useSession === 'function') {
      const { user } = useSession()
      if (user?.value) {
        return {
          id: user.value.id,
          name: user.value.name || user.value.email || 'Anonymous'
        }
      }
    }
  } catch {
    // Auth package not installed
  }

  // Return anonymous user with session-unique ID for presence tracking
  return {
    id: `anonymous-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Anonymous'
  }
}

/**
 * Composable for managing presence WebSocket connections for CRUD forms
 *
 * Watches for slideover state changes and establishes presence connections
 * when users open items for editing. Automatically cleans up connections
 * when forms are closed.
 */
export function useFormCollabPresence(): UseFormCollabPresenceReturn {
  // Skip on SSR
  if (import.meta.server) {
    return {
      activeConnections: ref(new Map()),
      cleanupConnection: () => {},
      cleanup: () => {}
    }
  }

  // Track active WebSocket connections by state ID
  const activeConnections = ref<Map<string, FormCollabConnection>>(new Map())

  // Cache user to avoid re-computing for each connection
  let cachedUser: { id: string; name: string } | null = null

  function getUser() {
    if (!cachedUser) {
      cachedUser = getCurrentUser()
    }
    return cachedUser
  }

  /**
   * Set up a presence WebSocket connection for a form state
   */
  function setupPresence(stateId: string, collection: string, itemId: string): void {
    // Skip if already connected for this state
    if (activeConnections.value.has(stateId)) {
      return
    }

    const roomId = `${collection}-${itemId}`
    const roomType = collection

    // Rooms are team-scoped; without a team there is no room to join
    const teamId = useCollabTeamId()
    if (!teamId) return

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/api/collab/${roomId}/ws?type=${roomType}&teamId=${encodeURIComponent(teamId)}`

      const ws = new WebSocket(url)

      // Store connection immediately so we can clean it up
      activeConnections.value.set(stateId, {
        stateId,
        roomId,
        roomType,
        ws
      })

      ws.onopen = () => {
        // Send awareness message to register presence
        const user = getUser()
        const awarenessMessage: CollabAwarenessState = {
          user: {
            id: user.id,
            name: user.name,
            color: generateUserColor(user.id)
          },
          cursor: null,
          selection: null,
          selectedNodeId: null,
          ghostNode: null
        }

        ws.send(JSON.stringify({
          type: 'awareness',
          userId: user.id,
          state: awarenessMessage
        }))
      }

      ws.onerror = () => {
        // Silent fail - presence is not critical functionality
        // Just clean up the connection
        cleanupConnection(stateId)
      }

      ws.onclose = () => {
        // Remove from active connections when closed
        activeConnections.value.delete(stateId)
      }
    } catch {
      // Silent fail - presence is not critical
    }
  }

  /**
   * Clean up a specific presence connection
   */
  function cleanupConnection(stateId: string): void {
    const connection = activeConnections.value.get(stateId)
    if (!connection) return

    const { ws } = connection

    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // Close when it opens
        ws.onopen = () => ws.close()
      }
    } catch {
      // Ignore errors during cleanup
    }

    activeConnections.value.delete(stateId)
  }

  /**
   * Clean up all active connections
   */
  function cleanup(): void {
    for (const [stateId] of activeConnections.value) {
      cleanupConnection(stateId)
    }
    activeConnections.value.clear()
  }

  // Connect presence for open edit states; drop connections for closed ones
  // fallow-ignore-next-line complexity
  function syncStates(states: any) {
    if (!states) return
    const activeStateIds = new Set<string>()

    for (const state of states) {
      if (!isActiveEdit(state)) continue
      activeStateIds.add(state.id)
      if (!activeConnections.value.has(state.id)) {
        setupPresence(state.id, state.collection, state.activeItem.id)
      }
    }

    for (const [stateId] of activeConnections.value) {
      if (!activeStateIds.has(stateId)) cleanupConnection(stateId)
    }
  }

  function isActiveEdit(state: any): boolean {
    return state.action === 'update' && !!state.isOpen && !!state.activeItem?.id && !!state.collection
  }

  // Watch for crouton states - only if useCrouton is available
  try {
    const crouton = useCrouton()

    if (crouton?.croutonStates) {
      // Watch for slideover state changes
      watch(
        () => crouton.croutonStates.value,
        syncStates,
        { deep: true, immediate: true }
      )
    }
  } catch {
    // useCrouton not available - that's fine, just don't watch
  }

  tryOnScopeDispose(cleanup)

  return {
    activeConnections,
    cleanupConnection,
    cleanup
  }
}
