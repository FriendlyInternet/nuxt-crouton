/**
 * Full-day rules (#2261) — pure, shared by the booking form and the server.
 *
 * A location offers the built-in full-day option when it has no named slots
 * (the original behaviour) or when its `offerFullDay` switch is on. The full
 * day is exclusive: it can't share a date with any other slot, whether that
 * slot is booked, in the cart, or ticked in the same booking.
 */
import type { SlotItem } from '../types/booking'

export const FULL_DAY_ID = 'all-day'

/** The slots a location offers, including the full day when it applies. */
export function withFullDay<T extends Pick<SlotItem, 'id'>>(
  slots: T[],
  offerFullDay: boolean | null | undefined,
  fullDay: T = { id: FULL_DAY_ID, label: 'All Day' } as unknown as T
): T[] {
  if (slots.length === 0) return [fullDay]
  return offerFullDay ? [...slots, fullDay] : slots
}

/**
 * Is `slotId` unavailable because of the full-day rule?
 * @param taken    slot ids already taken on the date (bookings + cart)
 * @param selected slot ids ticked in the booking being made
 */
export function isBlockedByFullDay(slotId: string, taken: string[], selected: string[]): boolean {
  if (slotId === FULL_DAY_ID) {
    return taken.length > 0 || selected.some(id => id !== FULL_DAY_ID)
  }
  return taken.includes(FULL_DAY_ID) || selected.includes(FULL_DAY_ID)
}

/** Would booking `requested` on a date that already has `existing` break the rule? */
export function fullDayConflict(requested: string[], existing: string[]): boolean {
  const wantsFullDay = requested.includes(FULL_DAY_ID)
  if (wantsFullDay && requested.some(id => id !== FULL_DAY_ID)) return true
  if (wantsFullDay && existing.length > 0) return true
  return existing.includes(FULL_DAY_ID) && requested.length > 0
}
