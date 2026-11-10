import { type Ref, type ComputedRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { CollabAwarenessState } from '../types/collab'
import { useCollabTeamId } from './useCollabTeamId'

// $fetch is auto-imported by Nuxt at runtime
declare const $fetch: typeof import('ofetch')['$fetch']

export interface UseCollabRoomUsersOptions {
  /**
   * Room ID to poll for users
   * Can be reactive (Ref) or static string
   */
  roomId: string | Ref<string | undefined>

  /**
   * Room type (e.g., 'page', 'flow', 'document')
   * Default: 'page'
   */
  roomType?: string

  /**
   * Team ID for server-side membership verification.
   * When provided, sent as ?teamId= query param for auth checks.
   */
  teamId?: string | Ref<string | undefined>

  /**
   * Polling interval in milliseconds
   * Default: 5000 (5 seconds)
   */
  pollInterval?: number

  /**
   * Whether to start polling immediately
   * Default: true
   */
  immediate?: boolean

  /**
   * Whether to exclude the current user from the count
   * Requires currentUserId to be provided
   * Default: true
   */
  excludeSelf?: boolean

  /**
   * Current user ID to exclude from count
   */
  currentUserId?: string | Ref<string | undefined>
}

export interface UseCollabRoomUsersReturn {
  /** All users in the room */
  users: Ref<CollabAwarenessState[]>

  /** Other users (excluding current user) */
  otherUsers: ComputedRef<CollabAwarenessState[]>

  /** Total user count */
  count: ComputedRef<number>

  /** Other user count (excluding current user) */
  otherCount: ComputedRef<number>

  /** Loading state for initial fetch */
  loading: Ref<boolean>

  /** Error state */
  error: Ref<Error | null>

  /** Manually trigger a refresh */
  refresh: () => Promise<void>

  /** Start polling */
  startPolling: () => void

  /** Stop polling */
  stopPolling: () => void

  /** Whether currently polling */
  isPolling: ComputedRef<boolean>
}

/**
 * Composable for polling collaboration room users
 *
 * Used for global presence - showing "X people editing" in collection lists.
 * Polls the HTTP endpoint instead of maintaining WebSocket connections
 * for efficiency (only polls visible items).
 *
 * @example
 * ```ts
 * // Basic usage
 * const { users, count } = useCollabRoomUsers({
 *   roomId: 'page-123',
 *   roomType: 'page'
 * })
 *
 * // With reactive room ID
 * const pageId = ref('page-123')
 * const { otherCount, otherUsers } = useCollabRoomUsers({
 *   roomId: pageId,
 *   roomType: 'page',
 *   currentUserId: user.value?.id,
 *   pollInterval: 10000
 * })
 * ```
 */
export function useCollabRoomUsers(options: UseCollabRoomUsersOptions): UseCollabRoomUsersReturn {
  const {
    roomType = 'page',
    pollInterval = 5000,
    immediate = true,
    excludeSelf = true
  } = options

  // Normalize roomId to ref
  const roomIdRef = typeof options.roomId === 'string'
    ? ref(options.roomId)
    : options.roomId as Ref<string | undefined>

  // Normalize teamId to ref
  const teamIdRef = typeof options.teamId === 'string'
    ? ref(options.teamId)
    : (options.teamId as Ref<string | undefined>) ?? ref(useCollabTeamId() ?? undefined)

  // Normalize currentUserId to ref
  const currentUserIdRef = typeof options.currentUserId === 'string'
    ? ref(options.currentUserId)
    : (options.currentUserId as Ref<string | undefined>) ?? ref(undefined)

  // State
  const users = ref<CollabAwarenessState[]>([])
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const pollingActive = ref(false)

  // Computed
  const otherUsers = computed(() => {
    if (!excludeSelf || !currentUserIdRef.value) {
      return users.value
    }
    return users.value.filter(u => u.user?.id !== currentUserIdRef.value)
  })

  const count = computed(() => users.value.length)
  const otherCount = computed(() => otherUsers.value.length)
  const isPolling = computed(() => pollingActive.value)

  /**
   * Fetch users from the API
   */
  async function fetchUsers(): Promise<void> {
    const roomId = roomIdRef.value
    if (!roomId) {
      users.value = []
      return
    }

    try {
      const url = `/api/collab/${roomId}/users`
      const query: Record<string, string> = { type: roomType }
      if (teamIdRef.value) {
        query.teamId = teamIdRef.value
      }
      const response = await $fetch<{ users: CollabAwarenessState[]; count: number }>(
        url,
        { query }
      )

      users.value = response.users || []
      error.value = null
    } catch (err) {
      error.value = err instanceof Error ? err : new Error('Failed to fetch users')
      // Don't clear users on error - keep stale data
    }
  }

  /**
   * Manual refresh
   */
  async function refresh(): Promise<void> {
    loading.value = true
    try {
      await fetchUsers()
    } finally {
      loading.value = false
    }
  }

  const { pause: pauseInterval, resume: resumeInterval } = useIntervalFn(
    () => {
      if (roomIdRef.value) {
        fetchUsers()
      }
    },
    pollInterval,
    { immediate: false }
  )

  /**
   * Start polling
   */
  function startPolling(): void {
    if (pollingActive.value) return
    pollingActive.value = true
    fetchUsers()
    resumeInterval()
  }

  /**
   * Stop polling
   */
  function stopPolling(): void {
    pollingActive.value = false
    pauseInterval()
  }

  // Watch for roomId changes
  watch(roomIdRef, (newId, oldId) => {
    if (newId !== oldId) {
      // Clear users when room changes
      users.value = []

      // Fetch new room users if polling is active
      if (pollingActive.value && newId) {
        fetchUsers()
      }
    }
  })

  // Lifecycle
  onMounted(() => {
    if (immediate && roomIdRef.value) {
      startPolling()
    }
  })

  return {
    users,
    otherUsers,
    count,
    otherCount,
    loading,
    error,
    refresh,
    startPolling,
    stopPolling,
    isPolling
  }
}
