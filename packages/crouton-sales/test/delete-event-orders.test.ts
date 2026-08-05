import { describe, it, expect } from 'vitest'
import { deleteAllEventOrders, type DeleteEventOrdersOps } from '../server/utils/delete-event-orders'

/**
 * Bulk "Delete all orders for an event" (#1519) — the pure cascade orchestration
 * behind the Settings danger-zone action. The endpoint wires the real drizzle
 * ops; this proves the ORCHESTRATION contract:
 *
 *  - scoped strictly to ONE eventId — a sibling event is never touched
 *  - cascade covers orders → order items → this event's print jobs
 *  - `salesClients` are NEVER in the cascade (they're reusable; open-tab totals
 *    reset naturally once the orders are gone). This is structural: the ops
 *    surface has no client deletion, so the orchestration cannot remove one.
 *  - only the sales domain's print jobs go (source === 'sales') — a foreign
 *    domain's job that happens to share the eventId survives
 *  - an event with zero orders short-circuits the item delete and returns zeros
 *  - returns per-table counts { orders, items, jobs }
 *
 * The ops are injected (same deps-injection idiom as printing-reactions.ts) so
 * the orchestration is unit-testable without a Nitro app or a live DB.
 */

interface Store {
  orders: { id: string, eventId: string }[]
  items: { id: string, orderId: string }[]
  jobs: { id: string, eventId: string, source: string }[]
  clients: { id: string, eventId: string }[]
}

/** Two events. Event A is the one being wiped; B must survive untouched. */
function seed(): Store {
  return {
    orders: [
      { id: 'A-o1', eventId: 'A' },
      { id: 'A-o2', eventId: 'A' },
      { id: 'B-o1', eventId: 'B' }
    ],
    items: [
      { id: 'A-i1', orderId: 'A-o1' },
      { id: 'A-i2', orderId: 'A-o1' },
      { id: 'A-i3', orderId: 'A-o2' },
      { id: 'B-i1', orderId: 'B-o1' }
    ],
    jobs: [
      { id: 'A-j1', eventId: 'A', source: 'sales' },
      { id: 'A-j2', eventId: 'A', source: 'sales' },
      // Same event, different domain — must survive the sales cascade.
      { id: 'A-jx', eventId: 'A', source: 'bookings' },
      { id: 'B-j1', eventId: 'B', source: 'sales' }
    ],
    clients: [
      { id: 'A-c1', eventId: 'A' },
      { id: 'B-c1', eventId: 'B' }
    ]
  }
}

/** Records the call order so cascade sequencing is assertable. */
function opsFor(store: Store): DeleteEventOrdersOps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async listOrderIds(eventId) {
      calls.push('listOrderIds')
      return store.orders.filter(o => o.eventId === eventId).map(o => o.id)
    },
    async deleteOrderItems(orderIds) {
      calls.push('deleteOrderItems')
      const before = store.items.length
      store.items = store.items.filter(i => !orderIds.includes(i.orderId))
      return before - store.items.length
    },
    async deleteEventPrintJobs(eventId) {
      calls.push('deleteEventPrintJobs')
      const before = store.jobs.length
      store.jobs = store.jobs.filter(j => !(j.eventId === eventId && j.source === 'sales'))
      return before - store.jobs.length
    },
    async deleteEventOrders(eventId) {
      calls.push('deleteEventOrders')
      const before = store.orders.length
      store.orders = store.orders.filter(o => o.eventId !== eventId)
      return before - store.orders.length
    }
  }
}

describe('deleteAllEventOrders — event-scoped cascade', () => {
  it('wipes only the target event and returns per-table counts', async () => {
    const store = seed()
    const ops = opsFor(store)

    const result = await deleteAllEventOrders('A', ops)

    expect(result).toEqual({ orders: 2, items: 3, jobs: 2 })
  })

  it('leaves the sibling event B fully intact', async () => {
    const store = seed()
    await deleteAllEventOrders('A', opsFor(store))

    expect(store.orders).toEqual([{ id: 'B-o1', eventId: 'B' }])
    expect(store.items).toEqual([{ id: 'B-i1', orderId: 'B-o1' }])
    expect(store.jobs.some(j => j.id === 'B-j1')).toBe(true)
  })

  it('never touches salesClients — of either event', async () => {
    const store = seed()
    await deleteAllEventOrders('A', opsFor(store))

    expect(store.clients).toEqual([
      { id: 'A-c1', eventId: 'A' },
      { id: 'B-c1', eventId: 'B' }
    ])
  })

  it('only deletes the sales domain print jobs (a foreign-domain job on the same event survives)', async () => {
    const store = seed()
    await deleteAllEventOrders('A', opsFor(store))

    expect(store.jobs.map(j => j.id).sort()).toEqual(['A-jx', 'B-j1'])
  })

  it('cascades items before orders (referential order)', async () => {
    const store = seed()
    const ops = opsFor(store)
    await deleteAllEventOrders('A', ops)

    expect(ops.calls.indexOf('deleteOrderItems')).toBeLessThan(ops.calls.indexOf('deleteEventOrders'))
  })

  it('short-circuits the item delete for an event with no orders', async () => {
    const store = seed()
    const ops = opsFor(store)

    const result = await deleteAllEventOrders('Z', ops)

    expect(result).toEqual({ orders: 0, items: 0, jobs: 0 })
    expect(ops.calls).not.toContain('deleteOrderItems')
    // Nothing removed.
    expect(store.orders).toHaveLength(3)
    expect(store.items).toHaveLength(4)
  })
})
