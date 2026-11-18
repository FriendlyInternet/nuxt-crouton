import { describe, it, expect } from 'vitest'
import { slotStatuses } from '../app/utils/slot-status'

// #4109 S7: a slot is full only when every listed product is at 0 there
const loc = { slots: [{ id: 'am' }, { id: 'pm' }], products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 2 }] }
const am = (s: ReturnType<typeof slotStatuses>) => s.find(x => x.id === 'am')!

describe('slotStatuses (#4109)', () => {
  it('S7: P full, Q free → am open, 1/3', () => {
    const s = slotStatuses(loc, [{ product: 'P', quantity: 1, slotIds: ['am'] }])
    expect(am(s)).toEqual({ id: 'am', bookedCount: 1, capacity: 3, isFull: false })
  })

  it('S7: P and Q both used up in am → am full, 3/3; pm open', () => {
    const s = slotStatuses(loc, [{ product: 'P', quantity: 1, slotIds: ['am'] }, { product: 'Q', quantity: 2, slotIds: ['am'] }])
    expect(am(s)).toEqual({ id: 'am', bookedCount: 3, capacity: 3, isFull: true })
    expect(s.find(x => x.id === 'pm')).toEqual({ id: 'pm', bookedCount: 0, capacity: 3, isFull: false })
  })

  it('S7: a listed product inactive in the team still adds stock and keeps am open', () => {
    // the helper takes no team list, so Q (inactive in the team) counts like any listed product
    const s = slotStatuses(loc, [{ product: 'P', quantity: 1, slotIds: ['am'] }])
    expect(am(s).capacity).toBe(3)
    expect(am(s).isFull).toBe(false)
  })

  it('a slotless location has one all-day entry; a full-day booking counts', () => {
    expect(slotStatuses({ slots: [], products: [{ product: 'P', stock: 2 }] }, [{ product: 'P', quantity: 1, slotIds: [] }]))
      .toEqual([{ id: 'all-day', bookedCount: 1, capacity: 2, isFull: false }])
  })

  it('a location listing no products is never full', () => {
    expect(slotStatuses({ slots: [{ id: 'am' }], products: [] }, [{ product: null, quantity: 1, slotIds: ['am'] }])[0]!.isFull).toBe(false)
  })
})
