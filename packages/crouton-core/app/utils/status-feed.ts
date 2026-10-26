export type StatusType = 'success' | 'info' | 'warning' | 'error'

export interface StatusMessage {
  id: string
  text: string
  /** Secondary text shown in the Recent list */
  description?: string
  icon?: string
  type: StatusType
  timestamp: number
  collection?: string
  operation?: string
  itemId?: string
  seen: boolean
  retry?: () => void
}

export const STATUS_EXPIRE_MS = 4000
export const STATUS_RECENT_MAX = 5

type Translate = (key: string, params?: Record<string, unknown>) => string

/** Errors stay until dismissed; everything else expires after STATUS_EXPIRE_MS. */
export function isStatusExpired(msg: StatusMessage, now: number): boolean {
  return msg.type !== 'error' && now - msg.timestamp >= STATUS_EXPIRE_MS
}

/** The message to show wide right now (newest first list in, newest live message out). */
export function currentStatus(messages: StatusMessage[], now: number): StatusMessage | undefined {
  return messages.find(m => !isStatusExpired(m, now))
}

/** Last N messages, newest first. Input is already newest first. */
export function recentStatuses(history: StatusMessage[]): StatusMessage[] {
  return history.slice(0, STATUS_RECENT_MAX)
}

/** A row from GET /api/teams/[teamId]/crouton-events (timestamp arrives as ISO string or epoch). */
export interface TeamEventRow {
  id: string
  timestamp: string | number
  operation: string
  collectionName: string
  userId?: string
  itemId?: string
  userName?: string
}

/**
 * Merge team events into the local history: dedupe (by id, and our own events
 * against in-memory entries for the same collection+item+operation), newest first, capped at STATUS_RECENT_MAX.
 */
export function mergeTeamEvents(history: StatusMessage[], events: TeamEventRow[], t: Translate, currentUserId?: string): StatusMessage[] {
  const known = new Set(history.map(m => m.id))
  const fromEvents: StatusMessage[] = []
  for (const ev of events) {
    const id = `event-${ev.id}`
    const timestamp = new Date(ev.timestamp).getTime()
    if (known.has(id) || Number.isNaN(timestamp)) continue
    const isOwn = !!currentUserId && ev.userId === currentUserId
    if (isOwn && ev.itemId && history.some(m =>
      !m.id.startsWith('event-')
      && m.collection === ev.collectionName
      && m.itemId === ev.itemId
      && m.operation === ev.operation,
    )) continue
    known.add(id)
    const userName = isOwn ? undefined : ev.userName?.split(' ')[0]
    const { text, icon } = mutationStatus({ operation: ev.operation, collection: ev.collectionName, userName }, t)
    fromEvents.push({ id, text, icon, type: 'success', timestamp, collection: ev.collectionName, operation: ev.operation, itemId: ev.itemId, seen: true })
  }
  return [...history, ...fromEvents]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, STATUS_RECENT_MAX)
}

/** Drop entries that came from team events (used when the team changes). */
export function dropTeamEvents(history: StatusMessage[]): StatusMessage[] {
  return history.filter(m => !m.id.startsWith('event-'))
}

/** Warnings/errors the user has not yet seen. */
export function unreadStatusCount(history: StatusMessage[]): number {
  return history.filter(m => !m.seen && (m.type === 'warning' || m.type === 'error')).length
}

export function markAllStatusSeen(history: StatusMessage[]): StatusMessage[] {
  return history.map(m => (m.seen ? m : { ...m, seen: true }))
}

/**
 * Derive a human-readable singular noun from a collection key.
 * e.g. "pagesPages" → "page", "bookingsLocations" → "location", "shopProducts" → "product"
 */
export function statusCollectionLabel(key: string): string {
  const match = key.match(/[A-Z][a-z]+$/)
  const raw = match ? match[0] : key
  const singular = raw.endsWith('s') && raw.length > 2 ? raw.slice(0, -1) : raw
  return singular.toLowerCase()
}

export interface MutationStatusInput {
  operation: string
  collection: string
  itemIds?: string[]
  itemName?: string
  userName?: string
}

interface StatusText { text: string, icon: string }

type StatusBuilder = (input: MutationStatusInput, ctx: { t: Translate, user: string, label: string, name?: string }) => StatusText

const MUTATION_STATUS: Record<string, StatusBuilder> = {
  create: (_input, { t, user, label, name }) => ({
    text: name ? t('statusBar.createdNamed', { user, label, name }) : t('statusBar.created', { user, label }),
    icon: 'i-lucide-plus',
  }),
  update: (_input, { t, user, label, name }) => ({
    text: name ? t('statusBar.savedNamed', { user, name }) : t('statusBar.saved', { user, label }),
    icon: 'i-lucide-check',
  }),
  delete: ({ itemIds }, { t, user, label }) => {
    const count = itemIds?.length || 1
    return {
      text: count > 1 ? t('statusBar.deletedMultiple', { user, count, label }) : t('statusBar.deleted', { user, label }),
      icon: 'i-lucide-trash-2',
    }
  },
  move: (_input, { t, user, label }) => ({ text: t('statusBar.reordered', { user, label }), icon: 'i-lucide-arrow-up-down' }),
}
MUTATION_STATUS.reorder = MUTATION_STATUS.move!

/** Map a `crouton:mutation` event to the status text + icon ("<FirstName> saved X"). */
export function mutationStatus(input: MutationStatusInput, t: Translate): StatusText {
  const { operation, collection, itemName, userName } = input
  const name = itemName && itemName.length > 30 ? `${itemName.slice(0, 30)}…` : itemName
  const ctx = { t, user: userName || t('statusBar.defaultUser'), label: statusCollectionLabel(collection), name }
  return MUTATION_STATUS[operation]?.(input, ctx) ?? { text: t('statusBar.done'), icon: 'i-lucide-check' }
}
