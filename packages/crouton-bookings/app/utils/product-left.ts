/**
 * Cart-aware free stock (#4109) — pure, no Vue. How many of `product` are still
 * free in `slotId` on `day`, counting the server's bookings for that date AND
 * the cart items at the same location on the same day.
 *
 * Product filtering and full-day expansion stay inside `leftFor`: a full-day
 * request needs room in every slot, and a cart item with no product counts
 * against every product (as an old booking row does).
 */
import { toDateKey } from '@fyit/crouton-core/shared/utils/date'
import type { AvailabilityBooking, CartItem } from '../types/booking'
import { leftFor, type CapacityBooking, type CapacityLocation } from './capacity'

export type ProductLeftCartItem = Pick<CartItem, 'locationId' | 'date' | 'day' | 'slotIds' | 'quantity'> & {
  productId?: string | null
}

export interface ProductLeftInput {
  /** The location, already normalised by the caller (no slots = the parsed `slots` list is empty) */
  location: CapacityLocation
  locationId: string
  /** YYYY-MM-DD */
  day: string
  product: string
  /** That date's non-cancelled bookings from the availability endpoint */
  bookings: AvailabilityBooking[] | CapacityBooking[]
  cart: ProductLeftCartItem[]
  slotId: string
}

export function productLeft({ location, locationId, day, product, bookings, cart, slotId }: ProductLeftInput): number {
  const fromCart: CapacityBooking[] = cart
    .filter(item => item.locationId === locationId && (item.day ?? toDateKey(new Date(item.date))) === day)
    .map(item => ({
      product: item.productId ?? null,
      quantity: item.quantity ?? 1,
      // legacy `inventory` id dropped; an empty list means the full day
      slotIds: (item.slotIds ?? []).filter(id => id !== 'inventory'),
    }))
  return leftFor(location, product, [...bookings, ...fromCart], slotId)
}
