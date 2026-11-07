// Module-scoped flag — not useState, which leaks SSR→client and skips client registration
let hookRegistered = false
let lastEventsFetch = 0
let eventsTeamId: string | undefined

const EVENTS_REFRESH_MIN_MS = 60_000
const EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const EVENTS_LIMIT = 20
/** Own events fetched separately when collab is on (the team query is dominated by teammates) */
const OWN_FLOOR = 10
/** Of the 5 feed slots, how many stay reserved for own changes */
const OWN_SLOTS = 3
/** One retry when the collab signal arrived before the teammate's event row was stored */
const REMOTE_RETRY_MS = 1000

function displayTitle(collection: string, record: Record<string, unknown>): string | undefined {
  try {
    const title = useDisplayConfig(collection).title
    return title && record[title] ? String(record[title]) : undefined
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
  const record = (result && typeof result === 'object' ? result : data) as Record<string, unknown> | undefined
  if (!record) return undefined

  const titled = displayTitle(collection, record)
  if (titled) return titled

  const field = ['title', 'name', 'label', 'subject', 'displayName']
    .find(f => record[f] && typeof record[f] === 'string')
  return field ? (record[field] as string) : undefined
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
  const refreshTeamEvents = async (force = false): Promise<number> => {
    if (!useCroutonApps().hasApp('events')) return 0
    const userId = getUserId()
    const live = useCroutonApps().hasApp('collab')
    const teamId = useTeamContext().getTeamId()
    const now = Date.now()
    if (teamId !== eventsTeamId) {
      eventsTeamId = teamId
      lastEventsFetch = 0
      history.value = dropTeamEvents(history.value)
    }
    if (!teamId || (!force && now - lastEventsFetch < EVENTS_REFRESH_MIN_MS)) return 0
    lastEventsFetch = now
    try {
      const url = `/api/teams/${teamId}/crouton-events`
      const dateFrom = new Date(now - EVENTS_WINDOW_MS).toISOString()
      const requests = live
        ? [
            $fetch<TeamEventRow[]>(url, { query: { userId, pageSize: OWN_FLOOR, dateFrom } }),
            $fetch<TeamEventRow[]>(url, { query: { pageSize: EVENTS_LIMIT, dateFrom } }),
          ]
        : [$fetch<TeamEventRow[]>(url, { query: { userId, pageSize: EVENTS_LIMIT, dateFrom } })]
      const settled = await Promise.allSettled(requests)
      const rows = settled.flatMap(r => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
      const before = new Set(history.value.map(m => m.id))
      history.value = mergeTeamEvents(history.value, rows, t, userId, live, live ? OWN_SLOTS : 0)
      return history.value.filter(m => m.id.startsWith('event-') && m.own === false && !before.has(m.id)).length
    } catch {
      // Feed falls back to own changes
      return 0
    }
  }

  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const onRemoteChange = async () => {
    const added = await refreshTeamEvents(true)
    if (!added) {
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
