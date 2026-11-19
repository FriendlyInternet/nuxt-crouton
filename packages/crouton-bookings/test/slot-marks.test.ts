/**
 * #4111 — the calendar marks each slot by the product rule: full only when every
 * listed product is at 0 in that slot; otherwise partly booked if anything is
 * booked; `booked / stock` summed; cancelled bookings marked separately.
 */
import { describe, it, expect } from 'vitest'
import { slotMarks } from '../app/utils/slot-marks'

const slots = [{ id: 's9' }, { id: 's10' }, { id: 's11' }]

describe('slotMarks (#4111)', () => {
  // covers: T1
  it('one product of stock 2 with one 09:00 booking → partly booked, not full', () => {
    const marks = slotMarks(
      { slots, products: [{ product: 'P', stock: 2 }] },
      [{ product: 'P', quantity: 1, slotIds: ['s9'], cancelled: false }],
    )
    expect(marks.bookedSlotIds).toEqual([])
    expect(marks.partialSlotIds).toEqual(['s9'])
    const s9 = marks.statuses.find(s => s.id === 's9')!
    expect(s9.bookedCount).toBe(1)
    expect(s9.capacity).toBe(2)
    expect(s9.isFull).toBe(false)
  })

  // covers: T1
  it('two products each used up at 09:00 → full', () => {
    const marks = slotMarks(
      { slots, products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] },
      [
        { product: 'P', quantity: 1, slotIds: ['s9'], cancelled: false },
        { product: 'Q', quantity: 1, slotIds: ['s9'], cancelled: false },
      ],
    )
    expect(marks.bookedSlotIds).toEqual(['s9'])
    expect(marks.partialSlotIds).toEqual([])
    const s9 = marks.statuses.find(s => s.id === 's9')!
    expect(s9.bookedCount).toBe(2)
    expect(s9.capacity).toBe(2)
  })

  // covers: T2
  it('a cancelled booking marks its slot cancelled and does not count as booked', () => {
    const marks = slotMarks(
      { slots, products: [{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }] },
      [
        { product: 'P', quantity: 1, slotIds: ['s9'], cancelled: false },
        { product: 'Q', quantity: 1, slotIds: ['s9'], cancelled: false },
        { product: 'P', quantity: 1, slotIds: ['s10'], cancelled: true },
      ],
    )
    expect(marks.cancelledSlotIds).toEqual(['s10'])
    const s10 = marks.statuses.find(s => s.id === 's10')!
    expect(s10.cancelledCount).toBe(1)
    expect(s10.bookedCount).toBe(0)
    expect(marks.bookedSlotIds).not.toContain('s10')
    expect(marks.partialSlotIds).not.toContain('s10')
  })
})
