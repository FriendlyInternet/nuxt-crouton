import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import type { Booking, LocationData } from '../types/booking'
import { FULL_DAY_ID } from './full-day'
import { parseLocationSlots, parseSlotIds } from '../composables/useBookingSlots'

/**
 * Is every given location full on `date`? (#2724) The one "fully booked" rule,
 * on local date keys. The caller decides which locations and bookings count
 * (e.g. only the filtered ones); cancelled bookings never do.
 *
 * - inventory mode: summed booking quantity reaches the location quantity
 * - slot mode: every slot reaches its capacity (an all-day booking fills each slot)
 * - no named slots: a single all-day slot of capacity 1
 */
export function isDayFullyBooked(
  date: Date,
  locations: Pick<LocationData, 'id' | 'inventoryMode' | 'quantity' | 'slots'>[],
  bookings: Pick<Booking, 'date' | 'status' | 'location' | 'slot' | 'quantity'>[],
): boolean {
  if (locations.length === 0) return false

  const key = toDateKey(date)
  const dayBookings = bookings.filter(b => b.status !== 'cancelled' && toDateKey(new Date(b.date)) === key)

  return locations.every((location) => {
    const mine = dayBookings.filter(b => b.location === location.id)

    if (location.inventoryMode) {
      const booked = mine.reduce((sum, b) => sum + (b.quantity ?? 1), 0)
      return booked >= (location.quantity ?? 1)
    }

    const slots = parseLocationSlots(location)
    if (slots.length === 0) return mine.length >= 1

    return slots.every((slot) => {
      const booked = mine.filter((b) => {
        const ids = parseSlotIds(b.slot)
        return ids.includes(slot.id) || ids.includes(FULL_DAY_ID)
      }).length
      return booked >= (slot.capacity ?? 1)
    })
  })
}
