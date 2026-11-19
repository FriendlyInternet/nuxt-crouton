/**
 * Per-slot calendar marks for one location on one day (#4111) — pure, no Vue.
 *
 * The rule: a slot is marked **full** only when the location lists at least one
 * product and every listed product is at 0 in that slot. A slot with any booking
 * that is not full is **partly booked**. The popover number is `booked / stock`,
 * booked = summed quantity, stock = summed over all listed products. A slot
 * holding a cancelled booking is marked **cancelled** (counted per booking).
 *
 * `bookings` = the day's bookings of the location, cancelled ones included.
 */
import { isFullDay, type CapacityBooking, type CapacityLocation } from './capacity'
import { slotStatuses, type DaySlotStatus } from './slot-status'

export interface MarkBooking extends CapacityBooking { cancelled: boolean }
export interface SlotMark extends DaySlotStatus { cancelledCount: number }
export interface SlotMarks {
  statuses: SlotMark[]
  bookedSlotIds: string[]
  partialSlotIds: string[]
  cancelledSlotIds: string[]
}

export function slotMarks(location: CapacityLocation, bookings: MarkBooking[]): SlotMarks {
  const active = bookings.filter(b => !b.cancelled)
  const cancelled = bookings.filter(b => b.cancelled)
  const statuses = slotStatuses(location, active).map(s => ({
    ...s,
    cancelledCount: cancelled.filter(b => isFullDay(b) || b.slotIds.includes(s.id)).length,
  }))
  return {
    statuses,
    bookedSlotIds: statuses.filter(s => s.isFull).map(s => s.id),
    partialSlotIds: statuses.filter(s => !s.isFull && s.bookedCount > 0).map(s => s.id),
    cancelledSlotIds: statuses.filter(s => s.cancelledCount > 0).map(s => s.id),
  }
}
