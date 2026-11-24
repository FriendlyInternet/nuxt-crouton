import { describe, it, expect } from 'vitest'
import { applyBookingToForm, editBookingBody, groupLabel, initialFormFromBooking } from '../app/utils/booking-form'

/**
 * #3843 — editing an inventory booking of 2 showed 1: the card never loaded
 * `booking.quantity` into the shared form state. The edit form must start
 * from the booking's saved values; a new booking starts at 1.
 */
const kayak = { id: 'k3', location: 'kayak', slot: null, group: null, quantity: 2 }

describe('applyBookingToForm — the shared form starts from the saved booking', () => {
  // One plain object standing in for the shared useState form across cases.
  const form = { editingBookingId: null as string | null, quantity: 1, productId: null as string | null }

  it('loads the saved quantity and the editing id', () => {
    applyBookingToForm(form, kayak)
    expect(form.quantity).toBe(2)
    expect(form.editingBookingId).toBe('k3')
  })

  it('a leftover quantity from an earlier form never wins', () => {
    form.quantity = 5
    applyBookingToForm(form, kayak)
    expect(form.quantity).toBe(2)
  })

  it('an earlier edit does not leak into a new booking', () => {
    applyBookingToForm(form, kayak)
    const initial = applyBookingToForm(form, null)
    expect(form.quantity).toBe(1)
    expect(form.editingBookingId).toBeNull()
    expect(initial).toEqual({ locationId: null, slotIds: [], groupId: null, quantity: 1, productId: null })
  })

  it('a booking without quantity after a quantity-2 edit gets 1', () => {
    applyBookingToForm(form, kayak)
    applyBookingToForm(form, { id: 's1', location: 'room', slot: '["matin"]', group: 'adults' })
    expect(form.quantity).toBe(1)
    expect(form.editingBookingId).toBe('s1')
  })
})

describe('initialFormFromBooking', () => {
  it('inventory booking with quantity 2 → 2', () => {
    expect(initialFormFromBooking(kayak)).toEqual({ locationId: 'kayak', slotIds: [], groupId: null, quantity: 2, productId: null })
  })

  it('missing / 0 / undefined quantity → 1', () => {
    expect(initialFormFromBooking({ location: 'kayak' }).quantity).toBe(1)
    expect(initialFormFromBooking({ location: 'kayak', quantity: 0 }).quantity).toBe(1)
    expect(initialFormFromBooking({ location: 'kayak', quantity: undefined }).quantity).toBe(1)
  })

  it('slot-mode booking keeps slots and group as before', () => {
    expect(initialFormFromBooking({ location: 'room', slot: '["matin","apres-midi"]', group: 'adults' }))
      .toEqual({ locationId: 'room', slotIds: ['matin', 'apres-midi'], groupId: 'adults', quantity: 1, productId: null })
  })

  it('array slot form (as staging returns it) gives the same ids', () => {
    expect(initialFormFromBooking({ location: 'room', slot: ['slot-0900'] }).slotIds).toEqual(['slot-0900'])
    expect(initialFormFromBooking({ location: 'room', slot: '["slot-0900"]' }).slotIds).toEqual(['slot-0900'])
  })

  it('no booking → empty form at quantity 1', () => {
    expect(initialFormFromBooking(undefined)).toEqual({ locationId: null, slotIds: [], groupId: null, quantity: 1, productId: null })
  })
})

/**
 * #4112 (S10, client) — an edit starts from the booking's own product and
 * amount, and saving sends both back.
 */
describe('edit keeps the product and amount (#4112)', () => {
  // covers: T1
  it('applyBookingToForm loads the booking\'s product into form.productId', () => {
    const form = { editingBookingId: null as string | null, quantity: 1, productId: 'stale' as string | null }
    applyBookingToForm(form, { id: 'b1', location: 'court', slot: '["0900"]', quantity: 2, product: 'cargo' })
    expect(form.productId).toBe('cargo')
    expect(form.quantity).toBe(2)
  })

  // covers: T1
  it('no product on the booking, or no booking → productId null', () => {
    const form = { editingBookingId: null as string | null, quantity: 1, productId: 'stale' as string | null }
    applyBookingToForm(form, { id: 'b2', location: 'court' })
    expect(form.productId).toBeNull()
    form.productId = 'stale'
    applyBookingToForm(form, null)
    expect(form.productId).toBeNull()
  })

  // covers: T1
  it('editBookingBody sends product and quantity, slot as an array', () => {
    expect(editBookingBody({ locationId: 'court', slotIds: ['0900', '1400'], groupId: 'g1', date: '2026-11-19', productId: 'cargo', quantity: 2 }))
      .toEqual({ location: 'court', slot: ['0900', '1400'], group: 'g1', date: '2026-11-19', quantity: 2, product: 'cargo' })
  })

  // covers: T1
  it('editBookingBody leaves product out when null, slot out without slots', () => {
    const body = editBookingBody({ locationId: 'kayak', slotIds: [], groupId: null, date: '2026-11-19', productId: null, quantity: 3 })
    expect(body).toEqual({ location: 'kayak', group: null, date: '2026-11-19', quantity: 3 })
    expect('product' in body).toBe(false)
    expect('slot' in body).toBe(false)
  })
})

describe('groupLabel', () => {
  const adults = { id: 'adults', label: 'Adults', translations: { label: { nl: 'Volwassenen', fr: 'Adultes' } } }

  it('uses the page locale translation', () => {
    expect(groupLabel(adults, 'fr')).toBe('Adultes')
    expect(groupLabel(adults, 'nl')).toBe('Volwassenen')
  })

  it('falls back to label when the locale has no translation', () => {
    expect(groupLabel(adults, 'en')).toBe('Adults')
  })

  it('group without translations → label', () => {
    expect(groupLabel({ id: 'youth', label: 'Youth' }, 'fr')).toBe('Youth')
  })

  it('no label or translations → value, then id', () => {
    expect(groupLabel({ id: 'youth', value: 'Jeugd' }, 'fr')).toBe('Jeugd')
    expect(groupLabel({ id: 'youth' }, 'fr')).toBe('youth')
  })
})
