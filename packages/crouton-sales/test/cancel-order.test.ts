/**
 * Cancelling an order — behaviour contract (#1941).
 *
 * Voiding a mis-punch without destroying the record. The counterpart to the
 * hard-delete in #1518: that one cascades the order away entirely, this one
 * only flips a status, and the row stays inspectable.
 *
 * ## What this pins
 *
 * The dangerous parts of a status write are not the write. They are:
 *   - **scope** — a bare `where(eq(id, orderId))` cancels another team's order,
 *     because an id from a URL is attacker-controlled;
 *   - **blast radius** — cancel must NOT reuse `deleteOrderCascade`; the line
 *     items are the record we are keeping;
 *   - **idempotency** — a double-tap on a physical till must not error.
 *
 * Table injected, like `handover.ts`: it lives in the consuming app's generated
 * layer, which a package unit test cannot resolve.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

import { CANCELLED_ORDER_STATUS } from '../shared/utils/order-status'
import { actorLabel, cancelOrder } from '../server/utils/cancel-order'

const orders = sqliteTable('sales_orders', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  eventId: text('eventId').notNull(),
  status: text('status').notNull(),
  updatedBy: text('updatedBy')
})

const orderitems = sqliteTable('sales_orderitems', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  quantity: real('quantity').notNull()
})

let db: ReturnType<typeof drizzle>

beforeEach(async () => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE sales_orders (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, eventId TEXT NOT NULL, status TEXT NOT NULL, updatedAt INTEGER, updatedBy TEXT)`)
  sqlite.exec(`CREATE TABLE sales_orderitems (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, quantity REAL NOT NULL)`)
  db = drizzle(sqlite)

  await db.insert(orders).values([
    { id: 'o-1', teamId: 't1', eventId: 'e1', status: 'completed' },
    { id: 'o-other-team', teamId: 't2', eventId: 'e1', status: 'completed' },
    { id: 'o-other-event', teamId: 't1', eventId: 'e2', status: 'completed' }
  ])
  await db.insert(orderitems).values([
    { id: 'i1', orderId: 'o-1', quantity: 3 },
    { id: 'i2', orderId: 'o-1', quantity: 2 }
  ])
})

const cancel = (orderId: string, over: Partial<{ teamId: string, eventId: string }> = {}) =>
  cancelOrder(db, {
    table: orders,
    orderId,
    teamId: 't1',
    eventId: 'e1',
    actor: 'admin-1',
    ...over
  })

const statusOf = async (id: string) => {
  const [row] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id))
  return row?.status
}

describe('cancelOrder', () => {
  it('sets the order to cancelled', async () => {
    const result = await cancel('o-1')

    expect(result.outcome).toBe('cancelled')
    expect(await statusOf('o-1')).toBe(CANCELLED_ORDER_STATUS)
  })

  it('keeps the line items — the record is the whole point', async () => {
    // If this ever fails, someone reached for deleteOrderCascade. Cancel is a
    // status write; destroying the items makes it a slower hard-delete.
    await cancel('o-1')

    const items = await db.select().from(orderitems).where(eq(orderitems.orderId, 'o-1'))
    expect(items).toHaveLength(2)
  })

  it('is idempotent — a double-tap reports already-cancelled, not an error', async () => {
    await cancel('o-1')
    const second = await cancel('o-1')

    expect(second.outcome).toBe('already-cancelled')
    expect(await statusOf('o-1')).toBe(CANCELLED_ORDER_STATUS)
  })

  it('records who cancelled it', async () => {
    await cancel('o-1')

    const [row] = await db.select({ by: orders.updatedBy }).from(orders).where(eq(orders.id, 'o-1'))
    expect(row?.by).toBe('admin-1')
  })
})

describe('cancelOrder — scope', () => {
  it('refuses another team\'s order and leaves it untouched', async () => {
    // The order id comes from a URL. Without the team predicate this is a
    // cross-tenant write, which is the whole reason the scope is a parameter.
    const result = await cancel('o-other-team')

    expect(result.outcome).toBe('not-found')
    expect(await statusOf('o-other-team')).toBe('completed')
  })

  it('refuses an order belonging to a different event of the same team', async () => {
    const result = await cancel('o-other-event')

    expect(result.outcome).toBe('not-found')
    expect(await statusOf('o-other-event')).toBe('completed')
  })

  it('reports not-found for an id that does not exist', async () => {
    expect((await cancel('nope')).outcome).toBe('not-found')
  })

  it('cannot be tricked into a blanket update', async () => {
    // Belt: whatever happens, one call changes at most one row.
    await cancel('o-1')

    expect(await statusOf('o-other-team')).toBe('completed')
    expect(await statusOf('o-other-event')).toBe('completed')
  })
})

describe('actorLabel', () => {
  it('prefers the display name', () => {
    expect(actorLabel({ name: 'Maarten', id: 'u-1' })).toBe('Maarten')
  })

  it('falls back to the id when there is no name', () => {
    expect(actorLabel({ id: 'u-1' })).toBe('u-1')
  })

  it('never writes undefined into the audit column', () => {
    // The whole point of the chain: an audit field reading 'undefined' is worse
    // than one reading 'admin', because it looks like data.
    expect(actorLabel(undefined)).toBe('admin')
    expect(actorLabel(null)).toBe('admin')
    expect(actorLabel({})).toBe('admin')
  })
})
