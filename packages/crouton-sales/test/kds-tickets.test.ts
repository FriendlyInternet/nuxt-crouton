/**
 * KDS ticket assembly — behaviour contract (#1766).
 *
 * `shapeDisplayTickets` takes the flat result of ONE query (each order item
 * joined to its product, left-joined to its bump) and groups it into the
 * tickets a kitchen screen renders — one per `(order × location)`.
 *
 * This logic exists today, but INLINE in the display-jobs handler, where it is
 * untestable — which is precisely how #1766's silent drop survived unnoticed
 * since the KDS was written (201c13625, 2026-06-15). Extracting it is half the
 * fix.
 *
 * The contract:
 *  - one ticket per (order × location); the kitchen and the bar clear the same
 *    order independently;
 *  - an item that cannot be routed reaches NO station — `schemas/products.json`
 *    marks `locationId` required, so a product without one is malformed data,
 *    and a kitchen screen is the wrong place to raise it;
 *  - …but it is still COUNTED, so the drop is observable rather than silent;
 *  - oldest order first — a kitchen works in arrival order.
 *
 * Bumped tickets are excluded in SQL now (see `kds-query-plan`), NOT here, so
 * the shaper never sees a bumped row and has no opinion about them.
 */
import { describe, it, expect } from 'vitest'
import { shapeDisplayTickets, type TicketRow } from '../server/utils/kds-tickets'

function row(over: Partial<TicketRow> & { orderId: string }): TicketRow {
  return {
    productId: 'prod-1',
    eventOrderNumber: 1,
    clientName: null,
    isPersonnel: false,
    createdAt: 1_000,
    locationId: 'kitchen',
    productTitle: 'Frieten',
    quantity: 1,
    remarks: null,
    ...over
  }
}

describe('shapeDisplayTickets — grouping', () => {
  it('splits one order into one ticket per location', () => {
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: 'kitchen', productTitle: 'Frieten', quantity: 2 }),
      row({ orderId: 'o1', locationId: 'bar', productTitle: 'Pintje', quantity: 1 })
    ])

    expect(tickets).toHaveLength(2)
    expect(tickets.map(t => t.locationId).sort()).toEqual(['bar', 'kitchen'])
    // Each screen sees only its own items — that is the whole point of the split.
    const kitchen = tickets.find(t => t.locationId === 'kitchen')!
    expect(kitchen.items).toEqual([{ title: 'Frieten', quantity: 2 }])
  })

  it('keeps every item of one location on a single ticket', () => {
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: 'kitchen', productTitle: 'Frieten', quantity: 2 }),
      row({ orderId: 'o1', locationId: 'kitchen', productTitle: 'Burger', quantity: 1 })
    ])

    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.items).toEqual([
      { title: 'Frieten', quantity: 2 },
      { title: 'Burger', quantity: 1 }
    ])
  })

  it('gives each ticket a stable id of orderId~locationId', () => {
    const { tickets } = shapeDisplayTickets([row({ orderId: 'o1', locationId: 'kitchen' })])
    expect(tickets[0]!.id).toBe('o1~kitchen')
  })

  it('orders tickets oldest-first, so a kitchen works in arrival order', () => {
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'newer', createdAt: 5_000, eventOrderNumber: 2 }),
      row({ orderId: 'older', createdAt: 1_000, eventOrderNumber: 1 })
    ])

    expect(tickets.map(t => t.orderId)).toEqual(['older', 'newer'])
  })
})

describe('shapeDisplayTickets — an unroutable item reaches no station, but is never silent (#1766 bug 2)', () => {
  // `schemas/products.json` marks `locationId` required ("Prep Location"), so a
  // product without one is malformed data, not a "needs no preparation" case.
  // A kitchen screen is therefore the WRONG place to surface it — owner's call:
  // an item with no location should not arrive anywhere.
  //
  // What must NOT survive is the silence. Today the handler drops these with a
  // bare `continue`, so a paid item nobody can make leaves no trace at all. The
  // shaper still counts them; the endpoint decides who gets told.
  it('keeps an item whose product has no location off every ticket', () => {
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: null, productTitle: 'Vergeten product' })
    ])

    expect(tickets).toEqual([])
  })

  it('keeps an item whose product row is gone off every ticket', () => {
    // Deleted product, or one belonging to another event: it can't be routed.
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: null, productTitle: null, productId: 'prod-deleted' })
    ])

    expect(tickets).toEqual([])
  })

  it('reports each unroutable item so the drop is observable, not silent', () => {
    const { unroutable } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: null, productId: 'prod-x', productTitle: 'Vergeten product' })
    ])

    expect(unroutable).toEqual([
      { orderId: 'o1', productId: 'prod-x', quantity: 1 }
    ])
  })

  it('reports nothing unroutable when every item routes', () => {
    const { unroutable } = shapeDisplayTickets([row({ orderId: 'o1', locationId: 'kitchen' })])
    expect(unroutable).toEqual([])
  })

  it('still builds the routable part of a part-broken order', () => {
    // One bad item must not cost the kitchen the rest of the order.
    const { tickets, unroutable } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: 'kitchen', productTitle: 'Frieten' }),
      row({ orderId: 'o1', locationId: null, productTitle: 'Vergeten product' })
    ])

    expect(tickets).toHaveLength(1)
    expect(tickets[0]!.locationId).toBe('kitchen')
    expect(tickets[0]!.items.map(i => i.title)).toEqual(['Frieten'])
    expect(unroutable).toHaveLength(1)
  })
})

describe('shapeDisplayTickets — carried-through order detail', () => {
  it('carries the order number, client name and staff flag onto every ticket', () => {
    const { tickets } = shapeDisplayTickets([
      row({ orderId: 'o1', locationId: 'kitchen', eventOrderNumber: 42, clientName: 'Jos', isPersonnel: true }),
      row({ orderId: 'o1', locationId: 'bar', eventOrderNumber: 42, clientName: 'Jos', isPersonnel: true })
    ])

    for (const ticket of tickets) {
      expect(ticket.orderNumber).toBe('42')
      expect(ticket.clientName).toBe('Jos')
      expect(ticket.isPersonnel).toBe(true)
    }
  })

  it('renders a missing order number as an em dash rather than "null"', () => {
    const { tickets } = shapeDisplayTickets([row({ orderId: 'o1', eventOrderNumber: null })])
    expect(tickets[0]!.orderNumber).toBe('—')
  })

  it('defaults a null staff flag to false', () => {
    const { tickets } = shapeDisplayTickets([row({ orderId: 'o1', isPersonnel: null })])
    expect(tickets[0]!.isPersonnel).toBe(false)
  })

  it('carries item remarks through, and omits the key when there are none', () => {
    const { tickets: withRemark } = shapeDisplayTickets([row({ orderId: 'o1', remarks: 'zonder ui' })])
    expect(withRemark[0]!.items[0]).toEqual({ title: 'Frieten', quantity: 1, remarks: 'zonder ui' })

    const { tickets: without } = shapeDisplayTickets([row({ orderId: 'o2', remarks: null })])
    expect(without[0]!.items[0]).not.toHaveProperty('remarks')
  })

  it('emits createdAt as an ISO string so the board can age it', () => {
    const { tickets } = shapeDisplayTickets([row({ orderId: 'o1', createdAt: 0 })])
    expect(tickets[0]!.createdAt).toBe(new Date(0).toISOString())
  })

  it('returns nothing for no rows, rather than throwing', () => {
    expect(shapeDisplayTickets([])).toEqual({ tickets: [], unroutable: [] })
  })
})
