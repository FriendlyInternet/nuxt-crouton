import { describe, it, expect } from 'vitest'
import { isDayFullyBooked } from '../app/utils/day-availability'

/**
 * #2724 — one "fully booked" rule for a day, on local date keys. The Panel
 * used to build keys with toISOString(), which is the previous day for a
 * local-midnight Date in Europe/Brussels.
 */
const DAY = new Date(2026, 9, 28) // 28 Oct, local midnight

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b', location: 'loc', date: new Date(2026, 9, 28).toISOString(), status: 'confirmed', slot: null, ...over,
}) as any

describe('isDayFullyBooked', () => {
  it('uses the local day, not the UTC day', () => {
    expect(DAY.toISOString().startsWith('2026-10-27')).toBe(true) // the trap
    expect(isDayFullyBooked(DAY, [{ id: 'loc' } as any], [booking()])).toBe(true)
    expect(isDayFullyBooked(new Date(2026, 9, 27), [{ id: 'loc' } as any], [booking()])).toBe(false)
  })

  it('is not fully booked with no locations', () => {
    expect(isDayFullyBooked(DAY, [], [booking()])).toBe(false)
  })

  it('all-day default: one booking fills the day, a cancelled one does not', () => {
    const loc = [{ id: 'loc' }] as any
    expect(isDayFullyBooked(DAY, loc, [])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking({ status: 'cancelled' })])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking()])).toBe(true)
  })

  it('slot mode: every slot must reach its capacity', () => {
    const loc = [{ id: 'loc', slots: JSON.stringify([{ id: 'am' }, { id: 'pm', capacity: 2 }]) }] as any
    const am = booking({ slot: '["am"]' })
    const pm = booking({ slot: ['pm'] })
    expect(isDayFullyBooked(DAY, loc, [am, pm])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [am, pm, pm])).toBe(true)
  })

  it('slot mode: an all-day booking fills every slot', () => {
    const loc = [{ id: 'loc', slots: [{ id: 'am' }, { id: 'pm' }] }] as any
    expect(isDayFullyBooked(DAY, loc, [booking({ slot: '["all-day"]' })])).toBe(true)
  })

  it('inventory mode: summed quantity reaches the location quantity', () => {
    const loc = [{ id: 'loc', inventoryMode: true, quantity: 3 }] as any
    expect(isDayFullyBooked(DAY, loc, [booking({ quantity: 2 })])).toBe(false)
    expect(isDayFullyBooked(DAY, loc, [booking({ quantity: 2 }), booking({ quantity: 1 })])).toBe(true)
  })

  it('every location must be full', () => {
    const locs = [{ id: 'loc' }, { id: 'other' }] as any
    expect(isDayFullyBooked(DAY, locs, [booking()])).toBe(false)
    expect(isDayFullyBooked(DAY, locs, [booking(), booking({ location: 'other' })])).toBe(true)
  })
})
