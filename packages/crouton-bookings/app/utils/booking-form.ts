import { parseSlotIds } from '../composables/useBookingSlots'

/**
 * The saved values of a booking the create/edit card starts from (#3843).
 * `slot` may arrive as a JSON string ('["matin"]') or already as an array.
 */
export interface BookingFormSource {
  id?: string
  location?: string | null
  slot?: string | string[] | null
  group?: string | null
  quantity?: number | null
  product?: string | null
}

export interface InitialBookingForm {
  locationId: string | null
  slotIds: string[]
  groupId: string | null
  quantity: number
  productId: string | null
}

/**
 * Map a booking to the card's initial form values. No booking → an empty
 * form with quantity 1. A missing or non-positive quantity becomes 1.
 */
export function initialFormFromBooking(booking?: BookingFormSource | null): InitialBookingForm {
  if (!booking) return { locationId: null, slotIds: [], groupId: null, quantity: 1, productId: null }
  const q = booking.quantity
  return {
    locationId: booking.location ?? null,
    slotIds: parseSlotIds(booking.slot),
    groupId: booking.group ?? null,
    quantity: typeof q === 'number' && Number.isInteger(q) && q > 0 ? q : 1,
    productId: booking.product ?? null,
  }
}

/**
 * The rule: the edit form starts from the booking's SAVED values, never from
 * what an earlier form left behind in the shared form state; a new booking
 * (no booking) starts at quantity 1. Writes into `form` and returns the
 * mapped values so the card can fill its local refs.
 */
export function applyBookingToForm(
  form: { editingBookingId: string | null; quantity: number; productId: string | null },
  booking?: BookingFormSource | null,
): InitialBookingForm {
  const initial = initialFormFromBooking(booking)
  form.editingBookingId = booking?.id ?? null
  form.quantity = initial.quantity
  form.productId = initial.productId
  return initial
}

export interface EditBookingInput {
  locationId: string | null
  slotIds: string[]
  groupId: string | null
  /** `YYYY-MM-DD` */
  date: string
  productId: string | null
  quantity: number
}

/**
 * The PATCH body the card sends when an edit is saved (#4112): the booking's
 * product and amount travel with it. A null product is left out, so an old
 * row stored without one keeps it that way. `slot` goes as a plain array of
 * slot ids; with no slot ids (a full-day booking) it is left out, so the
 * booking keeps the slot it has.
 */
export function editBookingBody(input: EditBookingInput) {
  return {
    location: input.locationId,
    ...(input.slotIds.length > 0 ? { slot: input.slotIds } : {}),
    group: input.groupId,
    date: input.date,
    quantity: input.quantity,
    ...(input.productId ? { product: input.productId } : {}),
  }
}

export interface BookingGroupOption {
  id: string
  label?: string
  value?: string
  translations?: { label?: Record<string, string | undefined> }
}

/** A group's label in `locale`, falling back to label → value → id. */
export function groupLabel(group: BookingGroupOption, locale: string): string {
  return group.translations?.label?.[locale]
    || group.label
    || group.value
    || group.id
}
