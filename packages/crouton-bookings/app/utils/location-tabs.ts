/**
 * The location tab row ⇄ location filter (#4471).
 *
 * The filter stays an array (`filters.locations`) so every reader keeps using
 * `includes` / `length`, but it only ever holds none or one id: the tab row
 * picks one location or "All", and the map pin / Locations block toggle one.
 */

/** The "All" tab's value — Reka tabs need a string, not `null`. */
export const ALL_LOCATIONS = '__all__'

/** Filter → tab value: `[]` → `null` (All); otherwise the first id (old multi-id state shows its first). */
export function tabValueFor(ids: string[]): string | null {
  return ids.length > 0 ? ids[0]! : null
}

/** Tab value → filter: `null`/`undefined`/"All" → `[]`; an id → `[id]`. */
export function locationsFor(value: string | null | undefined): string[] {
  if (value == null || value === ALL_LOCATIONS) return []
  return [value]
}

/** One-or-none toggle: picking the only selected location clears it; anything else selects just that one. */
export function pickOne(current: string[], id: string): string[] {
  return current.length === 1 && current[0] === id ? [] : [id]
}
