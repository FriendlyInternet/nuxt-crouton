/**
 * Booking capacity rule (#3139, per product since #4061) — pure, no Vue. The
 * one rule the calendar (`isDayFullyBooked`) and the batch endpoint both use;
 * the server's SQL guard (`guardSql`) is the same rule in SQL.
 *
 *   left(product, day, slot) = stock of that product
 *     − summed quantity of the day's bookings for that product (or no product)
 *       that hold that slot or the full day
 *
 * - a location with no named slots has one implicit full-day slot
 * - a full-day request needs room in every slot
 * - no slots = the parsed `slots` list is empty; the old slot capacity,
 *   location quantity and inventory switch are not read (#4172)
 *
 * Callers pass only the day's non-cancelled bookings of the location.
 */
import { FULL_DAY_ID } from './full-day'

export interface CapacityLocation {
  slots?: { id: string }[] | null
  /** The location's products with their stock (array, or the raw JSON string) */
  products?: { product: string, stock?: number | null }[] | string | null
}

export interface CapacityBooking {
  product?: string | null
  quantity?: number | null
  /** Slot ids the booking holds; empty or `all-day` = the full day */
  slotIds: string[]
}

export interface LocationProduct { product: string, stock?: number | null }

/** A location's `products` list (array, or the JSON string the raw column holds) */
export function parseLocationProducts(products: unknown): LocationProduct[] {
  let list: unknown = products
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list.filter(p => p && typeof p === 'object' && typeof (p as any).product === 'string')
}

/** Does the booking take the full day? (same predicate as the SQL guard) */
export function isFullDay(b: CapacityBooking): boolean {
  return b.slotIds.length === 0 || b.slotIds.includes(FULL_DAY_ID)
}

/** Does the booking hold `slotId`? A full-day booking holds every slot. */
function holds(b: CapacityBooking, slotId: string): boolean {
  return isFullDay(b) || b.slotIds.includes(slotId)
}

/** Does the booking count against `product`? A booking with no product counts against every one. */
function counts(b: CapacityBooking, product: string): boolean {
  return b.product == null || b.product === product
}

/** A stored quantity below 1 (old rows) counts as 1 */
function qty(b: CapacityBooking): number {
  return Math.max(1, b.quantity ?? 1)
}

/** The location's slot ids; `[all-day]` when it has none (the implicit full-day slot). */
export function slotIdsOf(location: CapacityLocation): string[] {
  const slots = location.slots ?? []
  return slots.length === 0 ? [FULL_DAY_ID] : slots.map(s => s.id)
}

/** Stock of `product` at `location`; 0 when it isn't listed. */
export function stockOf(location: CapacityLocation, product: string): number {
  const p = parseLocationProducts(location.products).find(p => p.product === product)
  return p?.stock ?? 0
}

/** How many of `product` are still free in `slotId` on a day with `bookings`. */
export function leftFor(location: CapacityLocation, product: string, bookings: CapacityBooking[], slotId: string): number {
  const slots = location.slots ?? []
  if (slotId === FULL_DAY_ID && slots.length > 0) {
    return Math.min(...slotIdsOf(location).map(id => leftFor(location, product, bookings, id)))
  }
  const used = bookings
    .filter(b => counts(b, product) && holds(b, slotId))
    .reduce((sum, b) => sum + qty(b), 0)
  return stockOf(location, product) - used
}

/** Does `qty` more of `product` fit in the requested slots? Empty or `all-day` = every slot. */
export function fitsCapacity(
  location: CapacityLocation,
  product: string,
  requestedSlotIds: string[],
  bookings: CapacityBooking[],
  qty = 1,
): boolean {
  const ids = requestedSlotIds.length === 0 || requestedSlotIds.includes(FULL_DAY_ID)
    ? slotIdsOf(location)
    : requestedSlotIds
  return ids.every(id => qty <= leftFor(location, product, bookings, id))
}

/** Is the location full — every product it lists at 0 in every slot? (calendar side) */
export function isLocationFull(location: CapacityLocation, bookings: CapacityBooking[]): boolean {
  const products = parseLocationProducts(location.products)
  if (products.length === 0) return false
  const ids = slotIdsOf(location)
  return products.every(p => ids.every(id => leftFor(location, p.product, bookings, id) <= 0))
}
