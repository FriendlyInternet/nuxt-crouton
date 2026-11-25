import { describe, it, expect } from 'vitest'
import { isDayFullyBooked } from '../app/utils/day-availability'

/**
 * #2724 — one "fully booked" rule for a day, on local date keys. The Panel
 * used to build keys with toISOString(), which is the previous day for a
 * local-midnight Date in Europe/Brussels.
 *
 * #4061 — counting is per product against its stock; locations carry
 * `products`, bookings carry `product`. Old columns are kept at a different
 * value to show they no longer count.
 */
const DAY = new Date(2026, 9, 28) // 28 Oct, local midnight

const P = (stock: number) => [{ product: 'P', stock }]

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b', location: 'loc', date: new Date(2026, 9, 28).toISOString(), status: 'confirmed', slot: null, product: 'P', ...over,
}) as any

describe('isDayFullyBooked', () => {
  it('uses the local day, not the UTC day', () => {
    expect(DAY.toISOString().startsWith('2026-10-27')).toBe(true) // the trap
    expect(isDayFullyBooked(DAY, [{ id: 'loc', products: P(1) } as any], [booking()])).toBe(true)
    expect(isDayFullyBooked(new Date(2026, 9, 27), [{ id: 'loc', products: P(1) } as any], [booking()])).toBe(false)
  })

  it('is not fully booked with no locations', () => {
    expect(isDayFullyBooked(DAY, [], [booking()])).toBe(false)
  })

  it('all-day default: one booking fills the day, a cancelled one does not', () => {
    const loc = [{ id: 'loc', products: P(1) }] as any
    expect(isDayFullyBooked(DAY, loc, [])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking({ status: 'cancelled' })])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking()])).toBe(true)
  })

  it('slot mode: every slot must reach the product stock', () => {
    const loc = [{ id: 'loc', slots: JSON.stringify([{ id: 'am' }, { id: 'pm' }]), products: JSON.stringify(P(2)) }] as any
    const am = booking({ slot: '["am"]' })
    const pm = booking({ slot: ['pm'] })
    expect(isDayFullyBooked(DAY, loc, [am, pm, pm])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [am, am, pm, pm])).toBe(true)
  })

  it('slot mode: an all-day booking fills every slot', () => {
    const loc = [{ id: 'loc', slots: [{ id: 'am' }, { id: 'pm' }], products: P(1) }] as any
    expect(isDayFullyBooked(DAY, loc, [booking({ slot: '["all-day"]' })])).toBe(true)
  })

  it('no slots: summed quantity reaches the product stock', () => {
    const loc = [{ id: 'loc', slots: [], products: P(3) }] as any
    expect(isDayFullyBooked(DAY, loc, [booking({ quantity: 2 })])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking({ quantity: 2 }), booking({ quantity: 1 })])).toBe(true)
  })

  it('every location must be full', () => {
    const locs = [{ id: 'loc', products: P(1) }, { id: 'other', products: P(1) }] as any
    expect(isDayFullyBooked(DAY, locs, [booking()])).toBe(false)
    expect(isDayFullyBooked(DAY, locs, [booking(), booking({ location: 'other' })])).toBe(true)
  })

  // covers: T2
  it('C10 full only when every product is 0 in every slot', () => {
    const loc = [{ id: 'loc', slots: [{ id: 'am' }, { id: 'pm' }], products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] }] as any
    const full = [booking({ slot: ['all-day'] })]
    expect(isDayFullyBooked(DAY, loc, full)).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [...full, booking({ slot: ['am'], product: 'Q' })])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [...full, booking({ slot: ['am'], product: 'Q' }), booking({ slot: ['pm'], product: 'Q' })])).toBe(true)
  })

  // covers: T2
  it('C10 a location with no products is left out; none with products → not full', () => {
    const locs = [{ id: 'loc', products: P(1) }, { id: 'empty' }] as any
    expect(isDayFullyBooked(DAY, locs, [booking()])).toBe(true)
    expect(isDayFullyBooked(DAY, [{ id: 'empty' }, { id: 'none', products: [] }] as any, [])).toBe(false)
  })

  // covers: T2
  it('C7 other product, cancelled and other-day bookings do not count', () => {
    const loc = [{ id: 'loc', products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] }] as any
    const other = [
      booking({ product: 'Q' }),
      booking({ status: 'cancelled' }),
      booking({ date: new Date(2026, 9, 29).toISOString() }),
    ]
    expect(isDayFullyBooked(DAY, loc, other)).toBe(false)
  })
})
