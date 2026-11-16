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
}

export interface InitialBookingForm {
  locationId: string | null
  slotIds: string[]
  groupId: string | null
  quantity: number
}

/**
 * Map a booking to the card's initial form values. No booking → an empty
 * form with quantity 1. A missing or non-positive quantity becomes 1.
 */
export function initialFormFromBooking(booking?: BookingFormSource | null): InitialBookingForm {
  if (!booking) return { locationId: null, slotIds: [], groupId: null, quantity: 1 }
  const q = booking.quantity
  return {
    locationId: booking.location ?? null,
    slotIds: parseSlotIds(booking.slot),
    groupId: booking.group ?? null,
    quantity: typeof q === 'number' && Number.isInteger(q) && q > 0 ? q : 1,
  }
}

/**
 * The rule: the edit form starts from the booking's SAVED values, never from
 * what an earlier form left behind in the shared form state; a new booking
 * (no booking) starts at quantity 1. Writes into `form` and returns the
 * mapped values so the card can fill its local refs.
 */
export function applyBookingToForm(
  form: { editingBookingId: string | null; quantity: number },
  booking?: BookingFormSource | null,
): InitialBookingForm {
  const initial = initialFormFromBooking(booking)
  form.editingBookingId = booking?.id ?? null
  form.quantity = initial.quantity
  return initial
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
