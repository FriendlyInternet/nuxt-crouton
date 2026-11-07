// Module-scoped flag — not useState, which leaks SSR→client and skips client registration
let hookRegistered = false
let lastEventsFetch = 0
let eventsTeamId: string | undefined
// Newest teammate row timestamp seen so far: "new" is judged against this, not the 5-slot feed
let newestTeamTs = 0

const EVENTS_REFRESH_MIN_MS = 60_000
const EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const EVENTS_LIMIT = 20
/** Of the 5 feed slots, how many stay reserved for own changes (also the size of the separate own fetch with collab) */
const OWN_SLOTS = 3
/** One retry when the collab signal arrived before the teammate's event row was stored */
const REMOTE_RETRY_MS = 2000

function mutationRecord(data?: Record<string, unknown>, result?: unknown): Record<string, unknown> | undefined {
  return (result && typeof result === 'object' ? result : data) as Record<string, unknown> | undefined
}

/** The collection's configured title field, if it has a display config. */
function displayTitleField(collection: string): string | undefined {
  try {
    return useDisplayConfig(collection).title || undefined
  } catch {
    // Collection may not have config — fall through to heuristics
    return undefined
  }
}

/**
 * Extract an item's display name from mutation data using display config or common field heuristics.
 */
function extractItemName(
  collection: string,
  data?: Record<string, unknown>,
  result?: unknown,
): string | undefined {
  return itemNameFromRecord(mutationRecord(data, result), displayTitleField(collection))
}

/**
 * Get current user's first name for status messages.
 */
function getUserFirstName(): string | undefined {
  try {
    const user = useState<{ name?: string } | null>('crouton-auth-user')
    const fullName = user.value?.name
    if (!fullName) return undefined
    return fullName.split(' ')[0]
  } catch {
    return undefined
  }
}

/** Current user's id, for recognising our own events. */
function getUserId(): string | undefined {
  try {
    return useState<{ id?: string } | null>('crouton-auth-user').value?.id
  } catch {
    return undefined
  }
}

export type StatusInput = Omit<StatusMessage, 'id' | 'timestamp' | 'seen'> & { seen?: boolean }

/**
 * Status feed: what just happened, with a lifetime per severity.
 * success/info/warning expire after STATUS_EXPIRE_MS; errors stay until dismissed.
 */
export function useCroutonStatus() {
  const { t } = useT()
  // `messages` holds live messages (newest first); `lastMessage` the latest ever pushed.
  const messages = useState<StatusMessage[]>('crouton-status-bar-messages', () => [])
  const lastMessage = useState<StatusMessage | null>('crouton-status-bar-last', () => null)
  const history = useState<StatusMessage[]>('crouton-status-feed-history', () => [])

  const current = computed<StatusMessage | undefined>(() => messages.value[0])
  const recent = computed(() => recentStatuses(history.value))
  const unread = computed(() => unreadStatusCount(history.value))

  const push = (msg: StatusInput) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const full: StatusMessage = { seen: false, ...msg, icon: msg.icon || 'i-lucide-check', id, timestamp: Date.now() }
    messages.value = [full, ...messages.value]
    lastMessage.value = full
    history.value = [full, ...history.value].slice(0, STATUS_RECENT_MAX)

    if (full.type !== 'error') {
      setTimeout(() => {
        messages.value = messages.value.filter((m: StatusMessage) => m.id !== id)
      }, STATUS_EXPIRE_MS)
    }
    return id
  }

  const dismiss = (id: string) => {
    messages.value = messages.value.filter((m: StatusMessage) => m.id !== id)
    history.value = history.value.map(m => (m.id === id ? { ...m, seen: true } : m))
  }

  const markAllSeen = () => {
    history.value = markAllStatusSeen(history.value)
  }

  /**
   * Merge recent changes (own; teammates' too with collab) from crouton-events into the feed. No-op without the
   * events app; throttled to once per minute unless `force`. Call on mount / pill open.
   */
  const refreshTeamEvents = async (force = false): Promise<number | null> => {
    if (!useCroutonApps().hasApp('events')) return null
    const userId = getUserId()
    const live = useCroutonApps().hasApp('collab')
    const teamId = useTeamContext().getTeamId()
    const now = Date.now()
    if (teamId !== eventsTeamId) {
      eventsTeamId = teamId
      lastEventsFetch = 0
      newestTeamTs = 0
      history.value = dropTeamEvents(history.value)
    }
    if (!teamId || (!force && now - lastEventsFetch < EVENTS_REFRESH_MIN_MS)) return null
    lastEventsFetch = now
    try {
      const url = `/api/teams/${teamId}/crouton-events`
      const dateFrom = new Date(now - EVENTS_WINDOW_MS).toISOString()
      const requests = live
        ? [
            $fetch<TeamEventRow[]>(url, { query: { userId, pageSize: OWN_SLOTS, dateFrom } }),
            $fetch<TeamEventRow[]>(url, { query: { pageSize: EVENTS_LIMIT, dateFrom } }),
          ]
        : [$fetch<TeamEventRow[]>(url, { query: { userId, pageSize: EVENTS_LIMIT, dateFrom } })]
      const settled = await Promise.allSettled(requests)
      // Any request failed (e.g. 403 for non-admins): not a timing gap, so no retry
      if (settled.some(r => r.status === 'rejected')) return null
      const rows = settled.flatMap(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
      history.value = mergeTeamEvents(history.value, rows, t, userId, live, live ? OWN_SLOTS : 0)
      const stamps = rows.filter(r => r.userId !== userId).map(r => new Date(r.timestamp).getTime()).filter(n => !Number.isNaN(n))
      const added = stamps.filter(n => n > newestTeamTs).length
      newestTeamTs = Math.max(newestTeamTs, ...stamps)
      return added
    } catch {
      // Feed falls back to own changes
      return null
    }
  }

  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const onRemoteChange = async () => {
    const added = await refreshTeamEvents(true)
    if (added === 0) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { refreshTeamEvents(true) }, REMOTE_RETRY_MS)
    }
  }

  if (import.meta.client && getCurrentInstance()) {
    onMounted(() => { refreshTeamEvents() })
  }

  // Live sync: a teammate's change lands in the feed within seconds (no polling, no throttle)
  if (import.meta.client && getCurrentInstance() && useCroutonApps().hasApp('collab') && useCroutonApps().hasApp('events')) {
    const debouncedRefresh = useDebounceFn(onRemoteChange, 1000)
    const stop = useNuxtApp().hook('crouton:remoteChange' as any, () => { debouncedRefresh() })
    onScopeDispose(() => { stop(); clearTimeout(retryTimer) })
  }

  // Register listener once per JS runtime (SSR and client each get their own)
  if (!hookRegistered) {
    hookRegistered = true

    const nuxtApp = useNuxtApp()
    nuxtApp.hook('crouton:mutation', (event: { operation: string, collection: string, itemIds?: string[], data?: Record<string, unknown>, result?: unknown }) => {
      const { operation, collection, itemIds, data, result } = event
      const { text, icon } = mutationStatus({
        operation,
        collection,
        itemIds,
        itemName: extractItemName(collection, data, result),
        userName: getUserFirstName(),
      }, t)
      push({ text, icon, type: 'success', collection, operation, itemId: itemIds?.[0] })
    })
  }

  return { messages, current, recent, unread, lastMessage, push, dismiss, markAllSeen, refreshTeamEvents, onRemoteChange }
}
