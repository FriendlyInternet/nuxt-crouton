/**
 * "My orders" payload assembly — behaviour contract (order-history slideover).
 *
 * `shapeMyOrders` takes the three raw query result sets (the active user's
 * orders, their items joined to products, and the orders' print jobs) and
 * shapes the slideover payload. The contract:
 *  - items are grouped under their order; an order with no items shapes to [];
 *  - each item's stored option **ids** resolve to product option **labels**
 *    (unknown ids fall back to the raw id);
 *  - the per-order print LED is the combined worst status (failed > busy >
 *    done), 'none' when the order has no jobs; display/KDS jobs are excluded;
 *  - the order total is the sum of its item totals.
 */
import { describe, it, expect } from 'vitest'
import {
  shapeMyOrders,
  bucketFromStatuses,
  resolveOptionLabels,
  type MyOrderInput,
  type MyOrderItemInput,
  type MyOrderJobInput
} from '../server/utils/my-orders-shape'

function order(over: Partial<MyOrderInput> & { id: string }): MyOrderInput {
  return {
    eventOrderNumber: 1,
    clientName: null,
    overallRemarks: null,
    isPersonnel: false,
    status: 'pending',
    createdAt: 0,
    ...over
  }
}

function item(over: Partial<MyOrderItemInput> & { id: string, orderId: string }): MyOrderItemInput {
  return {
    quantity: 1,
    unitPrice: 5,
    totalPrice: 5,
    remarks: null,
    selectedOptions: null,
    productTitle: 'Frietjes',
    productOptions: null,
    ...over
  }
}

describe('bucketFromStatuses', () => {
  it('is none with no jobs, failed on any 9, busy on any 0/1, else done', () => {
    expect(bucketFromStatuses([])).toBe('none')
    expect(bucketFromStatuses(['2', '9', '0'])).toBe('failed') // failed wins
    expect(bucketFromStatuses(['2', '1'])).toBe('busy')
    expect(bucketFromStatuses(['0'])).toBe('busy')
    expect(bucketFromStatuses(['2', '2'])).toBe('done')
  })
})

describe('resolveOptionLabels', () => {
  const opts = [{ id: 'a', label: 'Groot' }, { id: 'b', label: 'Klein' }]

  it('resolves ids (object or array), falls back to the raw id, and handles empties', () => {
    expect(resolveOptionLabels({ size: 'a' }, opts)).toEqual(['Groot'])
    expect(resolveOptionLabels(['a', 'b'], opts)).toEqual(['Groot', 'Klein'])
    expect(resolveOptionLabels(['zzz'], opts)).toEqual(['zzz']) // unknown id → raw
    expect(resolveOptionLabels(null, opts)).toEqual([])
    expect(resolveOptionLabels(['a'], null)).toEqual(['a']) // no product options
  })
})

describe('shapeMyOrders', () => {
  it('groups items under orders, computes totals, resolves options, and buckets print status', () => {
    const orders = [order({ id: 'o1', eventOrderNumber: 1 }), order({ id: 'o2', eventOrderNumber: 2 })]
    const items = [
      item({ id: 'i1', orderId: 'o1', totalPrice: 3.5, productTitle: 'Frietjes' }),
      item({
        id: 'i2', orderId: 'o1', quantity: 2, totalPrice: 10,
        productTitle: 'Hamburger', selectedOptions: { size: 'a' },
        productOptions: [{ id: 'a', label: 'Groot' }]
      }),
      item({ id: 'i3', orderId: 'o2', totalPrice: 5 })
    ]
    const jobs: MyOrderJobInput[] = [
      { refId: 'o1', status: '2', printMode: 'kitchen' },
      { refId: 'o1', status: '9', printMode: 'kitchen' }, // o1 has a failure → failed
      { refId: 'o2', status: '2', printMode: 'display' } // display excluded → o2 none
    ]

    const [o1, o2] = shapeMyOrders(orders, items, jobs)

    expect(o1.items).toHaveLength(2)
    expect(o1.total).toBe(13.5)
    expect(o1.items[1].optionLabels).toEqual(['Groot'])
    expect(o1.printStatus).toBe('failed')

    expect(o2.items).toHaveLength(1)
    expect(o2.printStatus).toBe('none') // its only job was a display job
  })

  it('shapes an order with no items to an empty list and none status', () => {
    const [o] = shapeMyOrders([order({ id: 'x' })], [], [])
    expect(o.items).toEqual([])
    expect(o.total).toBe(0)
    expect(o.printStatus).toBe('none')
  })
})
