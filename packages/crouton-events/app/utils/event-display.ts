import type { CroutonEvent, EventChange, EventOperation } from '../types/events'

/** Parse a JSON-stringified event value for display */
export function parseEventValue(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** Format any value for display */
export function formatEventValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

/** Check if a parsed value is complex (object/array) */
export function isComplexValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** Get full display info for a change entry */
export function getChangeDisplay(change: EventChange) {
  const oldVal = parseEventValue(change.oldValue)
  const newVal = parseEventValue(change.newValue)

  return {
    field: change.fieldName,
    oldValue: formatEventValue(oldVal),
    newValue: formatEventValue(newVal),
    isOldComplex: isComplexValue(oldVal),
    isNewComplex: isComplexValue(newVal),
    hasOld: change.oldValue !== null,
    hasNew: change.newValue !== null,
  }
}

/** Truncate long values for inline display */
export function truncateValue(value: string, maxLength = 50): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength) + '...'
}

const TITLE_FIELDS = ['title', 'name', 'label'] as const
const MAX_TITLE_LENGTH = 120

/** First non-empty string of a value — a plain string, or the first string of a translations-style object ({ fr: '…' }). */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      if (typeof inner === 'string' && inner.trim()) return inner.trim()
    }
  }
  return undefined
}

/**
 * Readable title of a record: `record[titleField]`, then `title`, `name`, `label`.
 * Trimmed, capped at 120 characters; `undefined` when none is found.
 */
export function pickRecordTitle(record: unknown, titleField?: string): string | undefined {
  if (!record || typeof record !== 'object') return undefined
  const obj = record as Record<string, unknown>
  const keys = titleField ? [titleField, ...TITLE_FIELDS] : [...TITLE_FIELDS]
  for (const key of keys) {
    const found = firstString(obj[key])
    if (found) return found.slice(0, MAX_TITLE_LENGTH)
  }
  return undefined
}

/**
 * Title of the record an event is about. Prefers `metadata.itemTitle` (saved by the tracker);
 * older events fall back to a `title`/`name`/`label` entry in `changes`. `''` when none.
 */
export function eventItemTitle(event: Pick<CroutonEvent, 'metadata' | 'changes'>): string {
  const saved = event.metadata?.itemTitle
  if (typeof saved === 'string' && saved.trim()) return saved.trim()

  for (const field of TITLE_FIELDS) {
    const change = event.changes?.find(c => c.fieldName === field)
    if (!change) continue
    const raw = change.newValue ?? change.oldValue
    const found = pickRecordTitle({ [field]: parseEventValue(raw) })
    if (found) return found
  }
  return ''
}

/** `veloBikes` → "Velo bikes" */
function humanizeName(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type Translate = (key: string) => string

/**
 * Readable collection name: `adminNav.label || displayName` from the collection registry,
 * run through `t()` (a missing key falls back to the raw label, as in AdminSidebar).
 * Unknown collections are split into words (`veloBikes` → "Velo bikes").
 */
export function eventCollectionLabel(
  name: string,
  collections: Record<string, any> | undefined,
  t: Translate
): string {
  const config = collections?.[name]
  const label: unknown = config?.adminNav?.label || config?.displayName
  if (typeof label !== 'string' || !label) return humanizeName(name)
  const translated = t(label)
  if (!translated || translated === label || (translated.startsWith('[') && translated.endsWith(']'))) return label
  return translated
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60]
]

/** Locale-aware relative time (fr: "il y a 5 minutes", "hier"). */
export function formatRelativeTime(date: Date | string | number, now: Date | number, locale: string): string {
  const seconds = Math.round((new Date(date).getTime() - new Date(now).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(seconds, 'second')
}

export interface EventQueryOptions {
  teamId?: string
  enrichUserData?: boolean
  filters?: {
    collectionName?: string
    operation?: EventOperation | ''
    userId?: string
    dateFrom?: Date
    dateTo?: Date
  }
  pagination?: {
    page?: number
    pageSize?: number
  }
}

/** Query parameters for GET /api/teams/:id/crouton-events — empty filters are dropped, dates become ISO. */
export function buildEventQuery(options: EventQueryOptions = {}): Record<string, string | number | boolean> {
  const f = options.filters ?? {}
  const candidates: Record<string, string | number | boolean | undefined> = {
    teamId: options.teamId,
    collectionName: f.collectionName,
    operation: f.operation,
    userId: f.userId,
    dateFrom: f.dateFrom?.toISOString(),
    dateTo: f.dateTo?.toISOString(),
    ...paginationQuery(options.pagination),
    enrichUserData: options.enrichUserData || undefined
  }
  // Drop empty values ('' / undefined) so they never reach the query string
  return Object.fromEntries(
    Object.entries(candidates).filter(([, value]) => value !== undefined && value !== '')
  ) as Record<string, string | number | boolean>
}

function paginationQuery(pagination: EventQueryOptions['pagination']) {
  if (!pagination) return {}
  return { page: pagination.page || 1, pageSize: pagination.pageSize || 50 }
}
