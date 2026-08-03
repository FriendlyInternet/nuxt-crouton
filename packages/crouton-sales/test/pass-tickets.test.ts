/**
 * Pass-screen read model — behaviour contract (#1761).
 *
 * The pass is the second stage of the KDS loop (#1755): stations press READY
 * (a `sales_kdsbumps` row per order × location), and an order becomes ready to
 * hand over only once EVERY location it touches has gone ready. `shapePassTickets`
 * takes the flat query result — each order item joined to its product and
 * left-joined to its bump — and decides which orders the runner should see.
 *
 * The contract:
 *  - an order appears only when all of its locations are bumped;
 *  - one ticket per ORDER, items un-split — the pass carries the whole order to
 *    the customer, unlike a station which sees only its own lines;
 *  - oldest first: at the pass, the oldest complete order is the one somebody
 *    has been waiting on longest;
 *  - already-handed-over orders are excluded in SQL (see `pass-query-plan`), so
 *    the shaper never sees one.
 */
import { describe, it, expect } from 'vitest'
import { shapePassTickets, type PassRow } from '../server/utils/pass-tickets'

function row(over: Partial<PassRow> & { orderId: string }): PassRow {
  return {
    productId: 'prod-1',
    eventOrderNumber: 1,
    clientName: null,
    isPersonnel: false,
    createdAt: 1_000,
    locationId: 'kitchen',
    bumped: true,
    productTitle: 'Frieten',
    quantity: 1,
    remarks: null,
    ...over
  }
}

describe('shapePassTickets — readiness', () => {
  it('offers an order whose only location has gone ready', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true })
    ])

    expect(tickets.map(t => t.orderId)).toEqual(['o1'])
  })

  it('offers an order once BOTH of its locations have gone ready', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true, productTitle: 'Frieten' }),
      row({ orderId: 'o1', locationId: 'bar', bumped: true, productTitle: 'Pintje' })
    ])

    expect(tickets).toHaveLength(1)
  })

  it('withholds an order while any one of its locations is still working', () => {
    // The whole point of the pass: fries ready + beer not poured = not yet
    // something a runner should carry out.
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true, productTitle: 'Frieten' }),
      row({ orderId: 'o1', locationId: 'bar', bumped: false, productTitle: 'Pintje' })
    ])

    expect(tickets).toEqual([])
  })

  it('withholds an order where nothing has gone ready yet', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: false })
    ])

    expect(tickets).toEqual([])
  })

  it('judges each order independently', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'ready', locationId: 'kitchen', bumped: true }),
      row({ orderId: 'waiting', locationId: 'kitchen', bumped: false })
    ])

    expect(tickets.map(t => t.orderId)).toEqual(['ready'])
  })
})

describe('shapePassTickets — the whole order, not a station slice', () => {
  it('puts every location\'s items on ONE ticket', () => {
    // A station sees its own lines; the runner carries the lot.
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true, productTitle: 'Frieten', quantity: 2 }),
      row({ orderId: 'o1', locationId: 'bar', bumped: true, productTitle: 'Pintje', quantity: 1 })
    ])

    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.items).toEqual([
      { title: 'Frieten', quantity: 2 },
      { title: 'Pintje', quantity: 1 }
    ])
  })

  it('carries the order number, client and staff flag', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', eventOrderNumber: 42, clientName: 'Jos', isPersonnel: true })
    ])

    expect(tickets[0]).toMatchObject({
      orderNumber: '42',
      clientName: 'Jos',
      isPersonnel: true
    })
  })

  it('renders a missing order number as an em dash, and a null staff flag as false', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', eventOrderNumber: null, isPersonnel: null })
    ])

    expect(tickets[0]!.orderNumber).toBe('—')
    expect(tickets[0]!.isPersonnel).toBe(false)
  })

  it('carries item remarks, omitting the key when absent', () => {
    const { tickets: withRemark } = shapePassTickets([row({ orderId: 'o1', remarks: 'zonder ui' })])
    expect(withRemark[0]!.items[0]).toEqual({ title: 'Frieten', quantity: 1, remarks: 'zonder ui' })

    const { tickets: without } = shapePassTickets([row({ orderId: 'o2', remarks: null })])
    expect(without[0]!.items[0]).not.toHaveProperty('remarks')
  })

  it('emits createdAt as an ISO string, so the pass can age the order', () => {
    const { tickets } = shapePassTickets([row({ orderId: 'o1', createdAt: 0 })])
    expect(tickets[0]!.createdAt).toBe(new Date(0).toISOString())
  })

  it('orders oldest-first — the longest wait is the most urgent', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'newer', createdAt: 5_000 }),
      row({ orderId: 'older', createdAt: 1_000 })
    ])

    expect(tickets.map(t => t.orderId)).toEqual(['older', 'newer'])
  })

  it('returns nothing for no rows, rather than throwing', () => {
    expect(shapePassTickets([])).toEqual({ tickets: [], unroutable: [] })
  })
})

describe('shapePassTickets — an unroutable item must not stall the order forever', () => {
  // An item whose product has no prep location reaches no station (#1766), so
  // there is no bump that could ever arrive for it. If such an item counted
  // toward readiness, the order would sit invisible at the pass FOREVER — the
  // exact silent-stall failure #1766 was about, one stage later.
  //
  // So readiness ignores unroutable items, and they are reported instead.
  it('still offers an order whose routable locations are all ready', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true, productTitle: 'Frieten' }),
      row({ orderId: 'o1', locationId: null, bumped: false, productTitle: 'Vergeten product' })
    ])

    expect(tickets).toHaveLength(1)
  })

  it('reports the unroutable item so the stall is visible, not silent', () => {
    const { unroutable } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true }),
      row({ orderId: 'o1', locationId: null, productId: 'prod-x', quantity: 2 })
    ])

    expect(unroutable).toEqual([{ orderId: 'o1', productId: 'prod-x', quantity: 2 }])
  })

  it('flags the ticket itself as incomplete, so the runner is warned before carrying it out', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true }),
      row({ orderId: 'o1', locationId: null, productTitle: 'Vergeten product' })
    ])

    expect(tickets[0]!.incomplete).toBe(true)
  })

  it('does not flag a fully routable order', () => {
    const { tickets } = shapePassTickets([row({ orderId: 'o1', locationId: 'kitchen', bumped: true })])
    expect(tickets[0]!.incomplete).toBe(false)
  })

  it('still lists the unroutable item on the ticket, so the runner can see what is missing', () => {
    const { tickets } = shapePassTickets([
      row({ orderId: 'o1', locationId: 'kitchen', bumped: true, productTitle: 'Frieten' }),
      row({ orderId: 'o1', locationId: null, productTitle: 'Vergeten product' })
    ])

    expect(tickets[0]!.items.map(i => i.title)).toEqual(['Frieten', 'Vergeten product'])
  })

  it('withholds an order whose ONLY items are unroutable', () => {
    // Nothing was ever prepared, so there is nothing to hand over. Offering it
    // would put an empty order in front of a customer.
    const { tickets, unroutable } = shapePassTickets([
      row({ orderId: 'o1', locationId: null, productTitle: 'Vergeten product' })
    ])

    expect(tickets).toEqual([])
    expect(unroutable).toHaveLength(1)
  })
})
