/**
 * Booking capacity rule (#3139) — pure, no Vue. The one rule the calendar
 * (`isDayFullyBooked`) and the batch endpoint both use.
 *
 * - inventory location: summed quantity of the day's bookings vs `location.quantity ?? 1`
 * - slot location: per slot, the number of bookings holding that slot (or the
 *   full day) vs `slot.capacity ?? 1`; `location.quantity` is ignored
 * - no named slots: one booking fills the day
 */
import { FULL_DAY_ID } from './full-day'

export interface CapacitySlot { id: string, capacity?: number | null }

export interface CapacityLocation {
  inventoryMode?: boolean | null
  quantity?: number | null
  slots?: CapacitySlot[]
}

export interface CapacityBooking {
  quantity?: number | null
  slotIds: string[]
}

/** One thing that must have room: `slotId: null` = any booking that day. */
export interface CapacityCheck { slotId: string | null, cap: number }

export type CapacityPlan =
  | { kind: 'inventory', cap: number }
  | { kind: 'slots', checks: CapacityCheck[] }

/** What must have room for `requested` slot ids to be booked at `location`. */
export function capacityPlan(location: CapacityLocation, requested: string[] = []): CapacityPlan {
  if (location.inventoryMode) return { kind: 'inventory', cap: location.quantity ?? 1 }

  const slots = location.slots ?? []
  if (slots.length === 0) return { kind: 'slots', checks: [{ slotId: null, cap: 1 }] }

  const wanted = requested.length === 0 || requested.includes(FULL_DAY_ID)
    ? slots
    : slots.filter(s => requested.includes(s.id))
  return { kind: 'slots', checks: wanted.map(s => ({ slotId: s.id, cap: s.capacity ?? 1 })) }
}

/** Does `qty` more still fit on a day that already has `existing` (non-cancelled) bookings? */
export function fitsCapacity(plan: CapacityPlan, existing: CapacityBooking[], qty = 1): boolean {
  if (plan.kind === 'inventory') {
    const used = existing.reduce((sum, b) => sum + (b.quantity ?? 1), 0)
    return used + qty <= plan.cap
  }
  return plan.checks.every(({ slotId, cap }) => {
    const used = slotId === null
      ? existing.length
      : existing.filter(b => b.slotIds.includes(slotId) || b.slotIds.includes(FULL_DAY_ID)).length
    return used < cap
  })
}

/** Is the day full — nothing more of any kind fits? (calendar side) */
export function isLocationFull(location: CapacityLocation, existing: CapacityBooking[]): boolean {
  if (location.inventoryMode) {
    return !fitsCapacity(capacityPlan(location), existing, 1)
  }
  const slots = location.slots ?? []
  if (slots.length === 0) return !fitsCapacity(capacityPlan(location), existing)
  return slots.every(slot => !fitsCapacity({ kind: 'slots', checks: [{ slotId: slot.id, cap: slot.capacity ?? 1 }] }, existing))
}
