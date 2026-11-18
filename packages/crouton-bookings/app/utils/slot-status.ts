/**
 * Per-slot status for a day (#4109) — pure, no Vue. One entry per slot of the
 * location (one `all-day` entry when it has no named slots):
 *
 * - `capacity`   summed stock of every product the location lists (inactive
 *                ones included — the server counts them too)
 * - `bookedCount` summed quantity (min 1) of the bookings holding that slot or the full day
 * - `isFull`     products listed AND every one is at 0 in that slot
 *
 * `bookings` = the day's non-cancelled bookings of the location.
 */
import { isFullDay, leftFor, parseLocationProducts, slotIdsOf, type CapacityBooking, type CapacityLocation } from './capacity'

export interface DaySlotStatus {
  id: string
  bookedCount: number
  capacity: number
  isFull: boolean
}

export function slotStatuses(location: CapacityLocation, bookings: CapacityBooking[]): DaySlotStatus[] {
  const products = parseLocationProducts(location.products)
  const capacity = products.reduce((sum, p) => sum + (p.stock ?? 0), 0)
  return slotIdsOf(location).map((id) => {
    const bookedCount = bookings
      .filter(b => isFullDay(b) || b.slotIds.includes(id))
      .reduce((sum, b) => sum + Math.max(1, b.quantity ?? 1), 0)
    const isFull = products.length > 0 && products.every(p => leftFor(location, p.product, bookings, id) <= 0)
    return { id, bookedCount, capacity, isFull }
  })
}
