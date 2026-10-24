export type StatusType = 'success' | 'info' | 'warning' | 'error'

export interface StatusMessage {
  id: string
  text: string
  icon?: string
  type: StatusType
  timestamp: number
  collection?: string
  operation?: string
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

/** Map a `crouton:mutation` event to the status text + icon ("<FirstName> saved X"). */
export function mutationStatus(input: MutationStatusInput, t: Translate): { text: string, icon: string } {
  const { operation, collection, itemIds, itemName, userName } = input
  const label = statusCollectionLabel(collection)
  const shortName = itemName && itemName.length > 30 ? `${itemName.slice(0, 30)}…` : itemName
  const user = userName || t('statusBar.defaultUser')

  if (operation === 'create') {
    return {
      text: shortName
        ? t('statusBar.createdNamed', { user, label, name: shortName })
        : t('statusBar.created', { user, label }),
      icon: 'i-lucide-plus',
    }
  }
  if (operation === 'update') {
    return {
      text: shortName
        ? t('statusBar.savedNamed', { user, name: shortName })
        : t('statusBar.saved', { user, label }),
      icon: 'i-lucide-check',
    }
  }
  if (operation === 'delete') {
    const count = Array.isArray(itemIds) ? itemIds.length : 1
    return {
      text: count > 1
        ? t('statusBar.deletedMultiple', { user, count, label })
        : t('statusBar.deleted', { user, label }),
      icon: 'i-lucide-trash-2',
    }
  }
  if (operation === 'move' || operation === 'reorder') {
    return { text: t('statusBar.reordered', { user, label }), icon: 'i-lucide-arrow-up-down' }
  }
  return { text: t('statusBar.done'), icon: 'i-lucide-check' }
}
