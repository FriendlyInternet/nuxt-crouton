import { describe, it, expect } from 'vitest'
import { productLeft } from '../app/utils/product-left'

// #4109 S2 + S9 (pure half): free stock counts server bookings AND the cart
const loc = (stock: number, slots = [{ id: 'am' }, { id: 'pm' }]) => ({ slots, products: [{ product: 'P', stock }, { product: 'Q', stock }] })
const cartItem = (extra: Record<string, unknown> = {}) => ({ locationId: 'L', date: '2026-11-10', day: '2026-11-10', slotIds: ['am'], quantity: 1, productId: 'P', ...extra })
const base = { locationId: 'L', day: '2026-11-10', product: 'P', slotId: 'am' }

describe('productLeft (#4109)', () => {
  it('S2: stock 3, one P am booking + one P am cart item → 1 left', () => {
    expect(productLeft({ ...base, location: loc(3), bookings: [{ product: 'P', quantity: 1, slotIds: ['am'] }], cart: [cartItem()] })).toBe(1)
  })

  it('S2: other products, other days and other locations do not count', () => {
    expect(productLeft({
      ...base,
      location: loc(3),
      bookings: [{ product: 'P', quantity: 1, slotIds: ['am'] }, { product: 'Q', quantity: 1, slotIds: ['am'] }],
      cart: [
        cartItem(),
        cartItem({ productId: 'Q' }),
        cartItem({ day: '2026-11-11', date: '2026-11-11' }),
        cartItem({ locationId: 'OTHER' }),
      ],
    })).toBe(1)
  })

  it('S9: stock 5, slots am/pm, one P am booking → 4 left for the full day', () => {
    expect(productLeft({ ...base, slotId: 'all-day', location: loc(5), bookings: [{ product: 'P', quantity: 1, slotIds: ['am'] }], cart: [] })).toBe(4)
  })

  it('a full-day cart item (legacy inventory id) holds every slot', () => {
    expect(productLeft({ ...base, slotId: 'pm', location: loc(3), bookings: [], cart: [cartItem({ slotIds: ['inventory'] })] })).toBe(2)
  })
})
