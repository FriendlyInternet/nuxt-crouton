import { describe, it, expect } from 'vitest'
import { fitsCapacity, isLocationFull, leftFor, parseLocationProducts } from '../app/utils/capacity'
import { isDayFullyBooked } from '../app/utils/day-availability'

/**
 * #4061 — free stock per product, per day, per slot:
 *   left(product, day, slot) = stock − summed quantity of that product's
 *   bookings that hold that slot or the full day.
 * Callers pass only the day's non-cancelled bookings (C7's cancelled/other-day
 * part is covered where that filter lives: day-availability + the SQL guard).
 */
const b = (slotIds: string[] = [], quantity = 1, product: string | null = 'P') => ({ slotIds, quantity, product })
const two = (stock: number, extra: Record<string, unknown> = {}) => ({ slots: [{ id: 'am' }, { id: 'pm' }], products: [{ product: 'P', stock }], ...extra })

describe('capacity rule (#3139)', () => {
  // Rewritten for #4061: stock decides
  it('location without slots, stock 1, accepts 1, refuses a 2nd', () => {
    const loc = { slots: [], products: [{ product: 'P', stock: 1 }] }
    expect(fitsCapacity(loc, 'P', [], [])).toBe(true)
    expect(fitsCapacity(loc, 'P', [], [b()])).toBe(false)
  })

  it('stock 5 accepts 5 in total and refuses the 6th', () => {
    const loc = { slots: [], products: [{ product: 'P', stock: 5 }] }
    expect(fitsCapacity(loc, 'P', [], [b([], 2)], 3)).toBe(true)
    expect(fitsCapacity(loc, 'P', [], [b([], 2)], 4)).toBe(false)
    expect(fitsCapacity(loc, 'P', [], [b([], 5)], 1)).toBe(false)
  })

  it('slot location: 1 per slot by default, other slot still open', () => {
    const loc = { slots: [{ id: 'am' }, { id: 'pm' }], products: [{ product: 'P', stock: 1 }] }
    expect(fitsCapacity(loc, 'P', ['am'], [b(['am'])])).toBe(false)
    expect(fitsCapacity(loc, 'P', ['pm'], [b(['am'])])).toBe(true)
  })

  it('slot location, stock 2, accepts 2 in a slot', () => {
    const loc = { slots: [{ id: 'am' }], products: [{ product: 'P', stock: 2 }] }
    expect(fitsCapacity(loc, 'P', ['am'], [b(['am'])])).toBe(true)
    expect(fitsCapacity(loc, 'P', ['am'], [b(['am']), b(['am'])])).toBe(false)
  })

  it('full-day request needs room in every slot', () => {
    const loc = { slots: [{ id: 'am' }, { id: 'pm' }], offerFullDay: true, products: [{ product: 'P', stock: 1 }] }
    expect(fitsCapacity(loc, 'P', ['all-day'], [b(['pm'])])).toBe(false)
    expect(fitsCapacity(loc, 'P', ['all-day'], [])).toBe(true)
  })

  it('no named slots: one booking fills the day', () => {
    const loc = { products: [{ product: 'P', stock: 1 }] }
    expect(fitsCapacity(loc, 'P', [], [])).toBe(true)
    expect(fitsCapacity(loc, 'P', [], [b()])).toBe(false)
  })

  it('calendar and server helper agree', () => {
    const loc = { id: 'loc', slots: [], products: [{ product: 'P', stock: 2 }] } as any
    const day = new Date(2026, 9, 28)
    const bk = (q: number) => ({ id: 'x', location: 'loc', date: day.toISOString(), status: 'active', slot: null, quantity: q, product: 'P' }) as any
    expect(isDayFullyBooked(day, [loc], [bk(2)])).toBe(isLocationFull(loc, [b([], 2)]))
    expect(isDayFullyBooked(day, [loc], [bk(1)])).toBe(isLocationFull(loc, [b([], 1)]))
  })
})

describe('capacity rule per product (#4061)', () => {
  // covers: T1
  it('C1 stock 3, 2 booked in am → am 1, pm 3, full day 1', () => {
    const loc = two(3)
    const bs = [b(['am']), b(['am'])]
    expect(leftFor(loc, 'P', bs, 'am')).toBe(1)
    expect(leftFor(loc, 'P', bs, 'pm')).toBe(3)
    expect(leftFor(loc, 'P', bs, 'all-day')).toBe(1)
  })

  // covers: T1
  it('C2 stock 5, 1 full-day booking → am 4, pm 4, full day 4', () => {
    const loc = two(5)
    for (const bs of [[b(['all-day'])], [b([])]]) {
      expect(leftFor(loc, 'P', bs, 'am')).toBe(4)
      expect(leftFor(loc, 'P', bs, 'pm')).toBe(4)
      expect(leftFor(loc, 'P', bs, 'all-day')).toBe(4)
    }
  })

  // covers: T1
  it('C3 stock 3, 2 in am then 1 full day → am 0, pm 2, full day 0', () => {
    const loc = two(3)
    const bs = [b(['am']), b(['am']), b(['all-day'])]
    expect(leftFor(loc, 'P', bs, 'am')).toBe(0)
    expect(leftFor(loc, 'P', bs, 'pm')).toBe(2)
    expect(leftFor(loc, 'P', bs, 'all-day')).toBe(0)
    expect(fitsCapacity(loc, 'P', ['pm'], bs, 2)).toBe(true)
    expect(fitsCapacity(loc, 'P', ['pm'], bs, 3)).toBe(false)
    expect(fitsCapacity(loc, 'P', ['all-day'], bs)).toBe(false)
  })

  // covers: T1
  it('C4 no slots, stock 8, 2 booked → 6 left', () => {
    const loc = { products: [{ product: 'P', stock: 8 }], slots: [] }
    const bs = [b([], 2)]
    expect(leftFor(loc, 'P', bs, 'all-day')).toBe(6)
    expect(fitsCapacity(loc, 'P', [], bs, 6)).toBe(true)
    expect(fitsCapacity(loc, 'P', [], bs, 7)).toBe(false)
  })

  // covers: T1
  it('C5 stock 1, three slots, the first booked → first 0, others 1, full day 0', () => {
    const loc = { slots: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], products: [{ product: 'P', stock: 1 }] }
    const bs = [b(['s1'])]
    expect(leftFor(loc, 'P', bs, 's1')).toBe(0)
    expect(leftFor(loc, 'P', bs, 's2')).toBe(1)
    expect(leftFor(loc, 'P', bs, 's3')).toBe(1)
    expect(leftFor(loc, 'P', bs, 'all-day')).toBe(0)
  })

  // covers: T1
  it('C6 one booking holding am and pm counts once in each', () => {
    const loc = two(2)
    const bs = [b(['am', 'pm'])]
    expect(leftFor(loc, 'P', bs, 'am')).toBe(1)
    expect(leftFor(loc, 'P', bs, 'pm')).toBe(1)
  })

  // covers: T1
  it('C7 a booking of another product Q does not count against P', () => {
    const loc = { slots: [{ id: 'am' }], products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] }
    const bs = [b(['am'], 1, 'Q')]
    expect(leftFor(loc, 'P', bs, 'am')).toBe(1)
    expect(leftFor(loc, 'Q', bs, 'am')).toBe(0)
    expect(fitsCapacity(loc, 'P', ['am'], bs)).toBe(true)
    expect(fitsCapacity(loc, 'Q', ['am'], bs)).toBe(false)
  })

  // covers: T1
  it('C10 full only when every product is 0 in every slot; no products → not full', () => {
    const loc = { slots: [{ id: 'am' }, { id: 'pm' }], products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] }
    expect(isLocationFull(loc, [b(['am']), b(['pm'])])).toBe(false)
    expect(isLocationFull(loc, [b(['am']), b(['pm']), b(['all-day'], 1, 'Q')])).toBe(true)
    expect(isLocationFull({ slots: [{ id: 'am' }] }, [b(['am'])])).toBe(false)
  })

  // covers: T1
  it('C10b full-day request at stock 1 with the morning booked → refused', () => {
    const loc = two(1, { offerFullDay: true })
    expect(fitsCapacity(loc, 'P', ['all-day'], [b(['am'])])).toBe(false)
    expect(fitsCapacity(loc, 'P', ['all-day'], [])).toBe(true)
  })

  // covers: T1
  it('C10c a booking with product NULL counts against every product', () => {
    const loc = { slots: [{ id: 'am' }], products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 2 }] }
    const bs = [b(['am'], 1, null)]
    expect(leftFor(loc, 'P', bs, 'am')).toBe(0)
    expect(leftFor(loc, 'Q', bs, 'am')).toBe(1)
  })

  // covers: T1
  it('an unlisted product has stock 0; a stored quantity below 1 counts as 1', () => {
    const loc = two(3)
    expect(fitsCapacity(loc, 'X', ['am'], [])).toBe(false)
    expect(leftFor(loc, 'P', [b(['am'], 0)], 'am')).toBe(2)
  })

  // covers: T1
  it('slot location, stock 3, takes 3 in a slot', () => {
    const loc = { slots: [{ id: 'am' }], products: [{ product: 'P', stock: 3 }] }
    expect(fitsCapacity(loc, 'P', ['am'], [b(['am']), b(['am'])])).toBe(true)
    expect(fitsCapacity(loc, 'P', ['am'], [b(['am']), b(['am']), b(['am'])])).toBe(false)
  })

  // covers: T1
  it('parses products from the raw JSON string column', () => {
    expect(parseLocationProducts('[{"product":"P","stock":2}]')).toEqual([{ product: 'P', stock: 2 }])
    expect(parseLocationProducts('nope')).toEqual([])
    expect(parseLocationProducts(null)).toEqual([])
  })

  // covers: T1
  it('calendar day check: stock 2', () => {
    const loc = { id: 'loc', slots: [], products: [{ product: 'P', stock: 2 }] } as any
    const day = new Date(2026, 9, 28)
    const bk = (q: number) => ({ id: 'x', location: 'loc', date: day.toISOString(), status: 'active', slot: null, quantity: q, product: 'P' }) as any
    expect(isDayFullyBooked(day, [loc], [bk(2)])).toBe(true)
    expect(isDayFullyBooked(day, [loc], [bk(1)])).toBe(false)
  })
})
