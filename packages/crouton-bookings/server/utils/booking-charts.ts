/**
 * Pure helpers for the booking chart endpoints (#4565).
 *
 * `pickChartLocale`, `slotIdsOf`, `countBySlotLabel` and `groupByMonth` need no
 * Nitro globals and no DB, so tests call them directly. `chartLocale` and
 * `chartTimezone` are thin wrappers that read the request + runtime config.
 */
import type { H3Event } from 'h3'
import { requiredLocale } from '@fyit/crouton-catalog/required-locale'
import { resolveSlotLabels } from './booking-emails'

/**
 * The language a chart's labels use: the page's `locale` query when the app
 * supports it, else the app's required (default) locale. Never a cookie —
 * crouton-i18n runs `no_prefix` without browser detection, so nothing sets one.
 */
export function pickChartLocale(queryLocale: unknown, supported: string[], defaultLocale?: string | null): string {
  if (typeof queryLocale === 'string' && supported.includes(queryLocale)) return queryLocale
  return requiredLocale(supported, defaultLocale)
}

export function chartLocale(event: H3Event): string {
  const cfg = (useRuntimeConfig(event) as any)?.croutonI18n ?? {}
  return pickChartLocale(getQuery(event).locale, cfg.supportedLocales ?? [], cfg.defaultLocale)
}

/** The bookings timezone — the same expression the booking writers store dates in. */
export function chartTimezone(event: H3Event): string {
  return (useRuntimeConfig(event) as any)?.croutonBookings?.timezone || 'Europe/Brussels'
}

/** `v` parsed as JSON when it is a string, else `v` itself; `undefined` when unparsable. */
function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) }
  catch { return undefined }
}

const nonEmptyStrings = (list: unknown[]): string[] => list.map(String).filter(Boolean)

/** A booking's slot ids: an array, a JSON-array string, or one plain id. */
export function slotIdsOf(slot: unknown): string[] {
  const parsed = parseJson(slot)
  if (Array.isArray(parsed)) return nonEmptyStrings(parsed)
  return nonEmptyStrings([slot ?? ''].map(s => String(s).trim()))
}

function parseLocationSlots(v: unknown): Array<{ id: string, label?: string }> {
  const parsed = parseJson(v)
  return Array.isArray(parsed) ? parsed : []
}

function labelsOfRow(row: { slot: unknown, locationSlots: unknown }, locale: string): string[] {
  const slots = parseLocationSlots(row.locationSlots)
  const ids = slotIdsOf(row.slot)
  if (!ids.length) return [resolveSlotLabels(null, slots, locale)]
  return ids.map(id => resolveSlotLabels([id], slots, locale))
}

function addTo(totals: Map<string, number>, key: string, n: number) {
  totals.set(key, (totals.get(key) ?? 0) + n)
}

/**
 * Count bookings per slot LABEL (not id): the same label at two locations is one
 * item, and a booking holding several slots counts once in each. Most booked first.
 */
export function countBySlotLabel(
  rows: { slot: unknown, locationSlots: unknown, count: number }[],
  locale: string
): { slot: string, count: number }[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    for (const label of labelsOfRow(row, locale)) addTo(totals, label, Number(row.count))
  }
  return [...totals]
    .map(([slot, count]) => ({ slot, count }))
    .sort((a, b) => b.count - a.count || a.slot.localeCompare(b.slot))
}

/**
 * Bucket bookings by calendar month IN `timeZone` (bookings are stored as local
 * midnight, so a 1 Feb booking is `…-01-31T23:00Z` and must land in February).
 * Sorted by month; `date` is the label in `locale`, e.g. « janv. 2026 ».
 */
export function groupByMonth(
  rows: { date: Date | number | string, count: number }[],
  locale: string,
  timeZone: string
): { date: string, count: number }[] {
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' })
  const labelFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone })
  const totals = new Map<string, number>()
  const labels = new Map<string, string>()
  for (const row of rows.filter(r => validDate(r.date))) {
    const d = new Date(row.date)
    const key = keyFmt.format(d)
    labels.set(key, labelFmt.format(d))
    addTo(totals, key, Number(row.count))
  }
  return [...totals.keys()].sort().map(k => ({ date: labels.get(k)!, count: totals.get(k)! }))
}

function validDate(v: unknown): boolean {
  return v != null && !Number.isNaN(new Date(v as any).getTime())
}
