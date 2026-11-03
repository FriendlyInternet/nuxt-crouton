import { describe, it, expect } from 'vitest'
import { capacityPlan, fitsCapacity, isLocationFull } from '../app/utils/capacity'
import { isDayFullyBooked } from '../app/utils/day-availability'

const b = (slotIds: string[] = [], quantity = 1) => ({ slotIds, quantity })

describe('capacity rule (#3139)', () => {
  it('day location with empty quantity accepts 1, refuses a 2nd', () => {
    const plan = capacityPlan({ inventoryMode: true })
    expect(fitsCapacity(plan, [])).toBe(true)
    expect(fitsCapacity(plan, [b()])).toBe(false)
  })

  it('stock 5 accepts 5 in total and refuses the 6th', () => {
    const plan = capacityPlan({ inventoryMode: true, quantity: 5 })
    expect(fitsCapacity(plan, [b([], 2)], 3)).toBe(true)
    expect(fitsCapacity(plan, [b([], 2)], 4)).toBe(false)
    expect(fitsCapacity(plan, [b([], 5)], 1)).toBe(false)
  })

  it('slot location: 1 per slot by default, other slot still open', () => {
    const loc = { slots: [{ id: 'am' }, { id: 'pm' }], quantity: 99 }
    expect(fitsCapacity(capacityPlan(loc, ['am']), [b(['am'])])).toBe(false)
    expect(fitsCapacity(capacityPlan(loc, ['pm']), [b(['am'])])).toBe(true)
  })

  it('slot capacity 2 accepts 2', () => {
    const loc = { slots: [{ id: 'am', capacity: 2 }] }
    expect(fitsCapacity(capacityPlan(loc, ['am']), [b(['am'])])).toBe(true)
    expect(fitsCapacity(capacityPlan(loc, ['am']), [b(['am']), b(['am'])])).toBe(false)
  })

  it('full-day request needs room in every slot', () => {
    const loc = { slots: [{ id: 'am' }, { id: 'pm' }], offerFullDay: true }
    expect(fitsCapacity(capacityPlan(loc, ['all-day']), [b(['pm'])])).toBe(false)
    expect(fitsCapacity(capacityPlan(loc, ['all-day']), [])).toBe(true)
  })

  it('no named slots: one booking fills the day', () => {
    expect(fitsCapacity(capacityPlan({}), [])).toBe(true)
    expect(fitsCapacity(capacityPlan({}), [b()])).toBe(false)
  })

  it('calendar and server helper agree', () => {
    const loc = { id: 'loc', inventoryMode: true, quantity: 2 } as any
    const day = new Date(2026, 9, 28)
    const bk = (q: number) => ({ id: 'x', location: 'loc', date: day.toISOString(), status: 'active', slot: null, quantity: q }) as any
    expect(isDayFullyBooked(day, [loc], [bk(2)])).toBe(isLocationFull(loc, [b([], 2)]))
    expect(isDayFullyBooked(day, [loc], [bk(1)])).toBe(isLocationFull(loc, [b([], 1)]))
  })
})
