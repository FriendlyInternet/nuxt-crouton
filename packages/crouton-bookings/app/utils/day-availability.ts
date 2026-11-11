import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import type { Booking, LocationData } from '../types/booking'
import { isLocationFull } from './capacity'
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
    const mine = dayBookings
      .filter(b => b.location === location.id)
      .map(b => ({ quantity: b.quantity, slotIds: parseSlotIds(b.slot) }))
    return isLocationFull(
      { inventoryMode: location.inventoryMode, quantity: location.quantity, slots: parseLocationSlots(location) },
      mine,
    )
  })
}
