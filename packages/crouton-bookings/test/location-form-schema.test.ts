/**
 * #4087 — a seeded location (null address/content/quantity fields, as read back from
 * staging) must pass the form's own schema, or the admin can't save it from the form.
 */
import { describe, it, expect } from 'vitest'
import { bookingsLocationSchema } from '../collections/locations/app/composables/useBookingsLocations'

const centerCourt = {
  id: 'loc-1',
  title: 'Center Court',
  color: '#22c55e',
  street: null,
  zip: null,
  city: 'Amsterdam',
  location: null,
  content: null,
  allowedMemberIds: null,
  slots: [{ id: 's1', label: 'Morning' }],
  products: [{ product: 'court', stock: 2 }],
  openDays: null,
  slotSchedule: null,
  blockedDates: null,
  offerFullDay: null,
  maxBookingsPerMonth: null,
  translations: { en: { title: 'Center Court' } }
}

describe('location form schema (#4087)', () => {
  it('F8 — accepts a seeded location with null fields', () => {
    const result = bookingsLocationSchema.safeParse(centerCourt)
    expect(result.success ? [] : result.error.issues.map(i => i.path.join('.'))).toEqual([])
  })

  it('still refuses a product with stock 0', () => {
    const result = bookingsLocationSchema.safeParse({ ...centerCourt, products: [{ product: 'p', stock: 0 }] })
    expect(result.success).toBe(false)
  })
})
