import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import type { Booking, LocationData } from '../types/booking'
import { isLocationFull, parseLocationProducts } from './capacity'
import { parseLocationSlots, parseSlotIds } from '../composables/useBookingSlots'

/**
 * Is every given location full on `date`? (#2724, per product since #4061)
 * The one "fully booked" rule, on local date keys. The caller decides which
 * locations and bookings count (e.g. only the filtered ones); cancelled
 * bookings never do.
 *
 * - a location is full when every product it lists has 0 left in every slot
 *   (a location with no named slots has one implicit full-day slot)
 * - locations that list no products are left out; none left → not full
 * - no slots = the parsed `slots` list is empty, as on the server (#4172)
 */
export function isDayFullyBooked(
  date: Date,
  locations: Pick<LocationData, 'id' | 'slots' | 'products'>[],
  bookings: Pick<Booking, 'date' | 'status' | 'location' | 'slot' | 'quantity' | 'product'>[],
): boolean {
  const counted = locations.filter(l => parseLocationProducts(l.products).length > 0)
  if (counted.length === 0) return false

  const key = toDateKey(date)
  const dayBookings = bookings.filter(b => b.status !== 'cancelled' && toDateKey(new Date(b.date)) === key)

  return counted.every((location) => {
    const mine = dayBookings
      .filter(b => b.location === location.id)
      .map(b => ({ product: b.product, quantity: b.quantity, slotIds: parseSlotIds(b.slot) }))
    return isLocationFull(
      { slots: parseLocationSlots(location), products: location.products },
      mine,
    )
  })
}
