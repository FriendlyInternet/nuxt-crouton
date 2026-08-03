import { describe, it, expect } from 'vitest'
import { deleteOrderCascade, findOwnedOrder, isOrderOwnedBy } from '../server/utils/delete-order'

/**
 * The pure hard-delete cascade for one sales order (#1518): line items →
 * print jobs → the order row. The drizzle calls are faked just enough to
 * capture WHICH table each delete hit, the WHERE condition it built, and to
 * hand back canned `returning()` rows so the counts can be asserted.
 *
 * The behaviour being pinned (the case list in the PR):
 *  1. deletes the order's line items (sales_orderitems WHERE orderId == id)
 *  2. deletes the order's print jobs SCOPED to source='sales' + refType='order'
 *     + refId=orderId — never a bare orderId match (print_jobs is shared across
 *     domains; a looser filter would nuke other orders'/domains' jobs)
 *  3. deletes the order row itself (sales_orders WHERE id == id)
 *  4. returns the removed item + job counts from the returning() results
 *  5. an order with no items/jobs still deletes the order and returns zero counts
 */

// Sentinel column refs — identity is all the fake needs.
const salesOrders = { id: 'orders.id' } as any
const salesOrderitems = { id: 'items.id', orderId: 'items.orderId' } as any
const printJobs = {
  id: 'jobs.id',
  source: 'jobs.source',
  refType: 'jobs.refType',
  refId: 'jobs.refId'
} as any

// Inspectable operator fakes: eq → {col,val}, and → {and:[...]}.
const ops = {
  eq: (col: any, val: any) => ({ col, val }),
  and: (...conds: any[]) => ({ and: conds })
} as any

interface RecordedDelete {
  table: any
  where: any
}

interface FakeDbOptions {
  /** returning() rows per table, keyed by the sentinel table object. */
  returning?: Map<any, Array<{ id: string }>>
}

function makeFakeDb(opts: FakeDbOptions = {}) {
  const deletes: RecordedDelete[] = []
  const returning = opts.returning ?? new Map()

  const db = {
    delete(table: any) {
      return {
        where(where: any) {
          deletes.push({ table, where })
          const rows = returning.get(table) ?? []
          // Both `await db.delete().where()` and
          // `db.delete().where().returning()` must resolve to the rows.
          return Object.assign(Promise.resolve(rows), {
            returning: () => Promise.resolve(rows)
          })
        }
      }
    }
  }

  return { db, deletes }
}

function deps(db: any) {
  return { db, tables: { salesOrders, salesOrderitems, printJobs }, ops }
}

describe('deleteOrderCascade', () => {
  it('deletes the order\'s line items by orderId', async () => {
    const { db, deletes } = makeFakeDb()
    await deleteOrderCascade('order-1', deps(db))

    const itemsDelete = deletes.find(d => d.table === salesOrderitems)
    expect(itemsDelete).toBeTruthy()
    expect(itemsDelete!.where).toMatchObject({ col: salesOrderitems.orderId, val: 'order-1' })
  })

  it('deletes the order\'s print jobs scoped to sales/order/orderId (not a bare orderId)', async () => {
    const { db, deletes } = makeFakeDb()
    await deleteOrderCascade('order-1', deps(db))

    const jobsDelete = deletes.find(d => d.table === printJobs)
    expect(jobsDelete).toBeTruthy()
    const conds = jobsDelete!.where.and as Array<{ col: any, val: any }>
    expect(conds).toEqual(expect.arrayContaining([
      { col: printJobs.source, val: 'sales' },
      { col: printJobs.refType, val: 'order' },
      { col: printJobs.refId, val: 'order-1' }
    ]))
  })

  it('deletes the order row itself by id', async () => {
    const { db, deletes } = makeFakeDb()
    await deleteOrderCascade('order-1', deps(db))

    const orderDelete = deletes.find(d => d.table === salesOrders)
    expect(orderDelete).toBeTruthy()
    expect(orderDelete!.where).toMatchObject({ col: salesOrders.id, val: 'order-1' })
  })

  it('returns the removed item and job counts from returning()', async () => {
    const returning = new Map<any, Array<{ id: string }>>([
      [salesOrderitems, [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }]],
      [printJobs, [{ id: 'j1' }, { id: 'j2' }]]
    ])
    const { db } = makeFakeDb({ returning })

    const result = await deleteOrderCascade('order-1', deps(db))
    expect(result).toEqual({ deletedItems: 3, deletedJobs: 2 })
  })

  it('still deletes the order and returns zero counts when it has no items or jobs', async () => {
    const { db, deletes } = makeFakeDb() // no returning rows → empty
    const result = await deleteOrderCascade('order-1', deps(db))

    expect(result).toEqual({ deletedItems: 0, deletedJobs: 0 })
    expect(deletes.find(d => d.table === salesOrders)).toBeTruthy()
  })
})

/**
 * The ownership guard the endpoint leans on so its handler stays a thin compose
 * (#1518). isOrderOwnedBy is the pure predicate; findOwnedOrder wraps the select.
 */
describe('isOrderOwnedBy', () => {
  const row = { id: 'order-1', eventId: 'event-1', teamId: 'team-1' }

  it('is true only when both event and team match', () => {
    expect(isOrderOwnedBy(row, 'event-1', 'team-1')).toBe(true)
  })

  it('is false for a different event', () => {
    expect(isOrderOwnedBy(row, 'event-2', 'team-1')).toBe(false)
  })

  it('is false for a different team (cross-team)', () => {
    expect(isOrderOwnedBy(row, 'event-1', 'team-2')).toBe(false)
  })

  it('is false for a missing order row', () => {
    expect(isOrderOwnedBy(null, 'event-1', 'team-1')).toBe(false)
    expect(isOrderOwnedBy(undefined, 'event-1', 'team-1')).toBe(false)
  })
})

describe('findOwnedOrder', () => {
  // Fake db supporting select().from().where().limit() → [row].
  function makeSelectDb(row: Record<string, unknown> | null) {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(row ? [row] : [])
          })
        })
      })
    }
  }
  const selDeps = (db: any) => ({ db, tables: { salesOrders, salesOrderitems, printJobs }, ops })

  it('returns the order when it belongs to the event + team', async () => {
    const db = makeSelectDb({ id: 'order-1', eventId: 'event-1', teamId: 'team-1' })
    const found = await findOwnedOrder('order-1', 'event-1', 'team-1', selDeps(db))
    expect(found).toEqual({ id: 'order-1', eventId: 'event-1', teamId: 'team-1' })
  })

  it('returns null for a cross-event order', async () => {
    const db = makeSelectDb({ id: 'order-1', eventId: 'other-event', teamId: 'team-1' })
    expect(await findOwnedOrder('order-1', 'event-1', 'team-1', selDeps(db))).toBeNull()
  })

  it('returns null for a cross-team order', async () => {
    const db = makeSelectDb({ id: 'order-1', eventId: 'event-1', teamId: 'other-team' })
    expect(await findOwnedOrder('order-1', 'event-1', 'team-1', selDeps(db))).toBeNull()
  })

  it('returns null when the order does not exist', async () => {
    const db = makeSelectDb(null)
    expect(await findOwnedOrder('missing', 'event-1', 'team-1', selDeps(db))).toBeNull()
  })
})
