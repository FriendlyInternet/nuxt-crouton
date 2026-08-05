/**
 * "A cancelled order didn't happen" — behaviour contract (#1925).
 *
 * Every money/unit aggregation must skip cancelled orders. Five read models
 * already did (`countOutstanding`, `per-product-totals`, `client-tab`,
 * `kds-tickets`, `pass-tickets`); all seven chart endpoints did not. That
 * asymmetry was harmless only because nothing could *produce* a cancelled order
 * — #1941 adds the button, which is what turns this from latent to load-bearing.
 *
 * ## The test that actually matters here
 *
 * Asserting "the condition excludes cancelled rows" is nearly tautological. The
 * failure mode this file exists to catch is different and much more likely:
 * **someone adds an eighth chart endpoint and forgets the filter.** A behaviour
 * test on the seven that exist today cannot fail for the one that doesn't exist
 * yet — so the last describe block reads the endpoint directory and holds every
 * present and future file to the rule, with `orders-by-status` as the one
 * explicitly-named exception.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import { sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

import { excludesCancelledOrders } from '../server/utils/order-status'
import { CANCELLED_ORDER_STATUS } from '../shared/utils/order-status'

const orders = sqliteTable('sales_orders', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  status: text('status').notNull()
})

const orderitems = sqliteTable('sales_orderitems', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  quantity: real('quantity').notNull(),
  totalPrice: real('totalPrice').notNull()
})

let db: ReturnType<typeof drizzle>

beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE sales_orders (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, status TEXT NOT NULL)`)
  sqlite.exec(`CREATE TABLE sales_orderitems (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, quantity REAL NOT NULL, totalPrice REAL NOT NULL)`)
  db = drizzle(sqlite)
})

async function seed() {
  await db.insert(orders).values([
    { id: 'o-live', teamId: 't1', status: 'completed' },
    { id: 'o-pending', teamId: 't1', status: 'pending' },
    { id: 'o-failed', teamId: 't1', status: 'print_failed' },
    { id: 'o-void', teamId: 't1', status: CANCELLED_ORDER_STATUS }
  ])
  await db.insert(orderitems).values([
    { id: 'i1', orderId: 'o-live', quantity: 3, totalPrice: 9 },
    { id: 'i2', orderId: 'o-pending', quantity: 1, totalPrice: 3 },
    { id: 'i3', orderId: 'o-failed', quantity: 2, totalPrice: 6 },
    { id: 'i4', orderId: 'o-void', quantity: 50, totalPrice: 150 }
  ])
}

/** Stand-in for what every chart endpoint does: sum something over joined items. */
async function revenue() {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${orderitems.totalPrice}), 0)` })
    .from(orderitems)
    .innerJoin(orders, eq(orders.id, orderitems.orderId))
    .where(and(eq(orders.teamId, 't1'), excludesCancelledOrders(orders)))
  return Number(row?.total ?? 0)
}

describe('excludesCancelledOrders', () => {
  beforeEach(seed)

  it('drops a cancelled order from the total', async () => {
    // 9 + 3 + 6 = 18. The cancelled 150 must not appear.
    expect(await revenue()).toBe(18)
  })

  it('keeps print_failed — the sale happened, the ticket did not print', async () => {
    // The error worth guarding by name: sweeping print_failed in with cancelled
    // would UNDER-report real money, which is the opposite mistake and just as
    // wrong. `print_failed` means a printer problem, not a voided sale.
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${orderitems.totalPrice}), 0)` })
      .from(orderitems)
      .innerJoin(orders, eq(orders.id, orderitems.orderId))
      .where(and(eq(orders.id, 'o-failed'), excludesCancelledOrders(orders)))

    expect(Number(row?.total)).toBe(6)
  })

  it('is NULL-safe by construction — status is NOT NULL in the generated schema', async () => {
    // `ne(col, x)` is NULL for a NULL row, which would silently DROP it. The
    // generated column is text('status').notNull(), so this cannot bite — pinned
    // here so a schema change that relaxes it fails a test rather than quietly
    // deleting rows from every chart.
    const cols = await db.all<{ name: string, notnull: number }>(sql`PRAGMA table_info(sales_orders)`)
    const status = cols.find(c => c.name === 'status')
    expect(status?.notnull).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The structural guard — the reason this file exists.
// ---------------------------------------------------------------------------

/** Source with comments removed — so a file may discuss what it must not hardcode. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('every money/unit chart endpoint excludes cancelled orders', () => {
  const CHARTS_DIR = join(__dirname, '../server/api/crouton-sales/teams/[id]/charts')

  /**
   * Exemptions, each with a stated reason — named here rather than silently
   * skipped, so removing one is a conscious act:
   *
   *   - `orders-by-status` groups BY status, so filtering would delete the
   *     `cancelled` bucket the chart exists to show.
   *   - `per-product-totals` is a thin handler that delegates to
   *     `per-product-totals.ts`, where the filter lives; its behaviour is
   *     covered by `per-product-totals.test.ts` rather than by this grep.
   */
  const EXEMPT = new Map([
    ['orders-by-status.get.ts', 'groups by status — the cancelled bucket is the point'],
    ['per-product-totals.get.ts', 'thin handler; filters in the util it delegates to']
  ])

  const endpoints = readdirSync(CHARTS_DIR).filter(f => f.endsWith('.get.ts'))

  it('finds the chart endpoints at all (guards against a moved directory)', () => {
    // Without this, a renamed folder turns the whole block into zero assertions
    // that pass — a green test proving nothing.
    expect(endpoints.length).toBeGreaterThan(5)
  })

  it.each(endpoints.filter(f => !EXEMPT.has(f)))(
    '%s scopes through the shared chartOrderScope',
    (file) => {
      const src = stripComments(readFileSync(join(CHARTS_DIR, file), 'utf8'))

      // The clause is built in ONE place, so a ninth endpoint inherits every
      // rule — including ones added after it was written — rather than being
      // trusted to remember them. A hand-rolled WHERE here would pass a
      // behaviour test today and silently miss tomorrow's rule.
      expect(src).toContain('chartOrderScope(salesOrders')

      // ...and must not opt out of the cancelled filter.
      expect(src).not.toContain('includeCancelled')

      // ...nor re-spell the status literal. Comments are stripped first: a file
      // may *discuss* cancellation, it just must not hardcode the value.
      expect(src).not.toMatch(/['"]cancelled['"]/)
    }
  )

  it('orders-by-status opts out explicitly, and says why', () => {
    const src = readFileSync(join(CHARTS_DIR, 'orders-by-status.get.ts'), 'utf8')

    // Still on the shared scope — it must not diverge on team/event/personnel
    // just because it differs on one rule.
    expect(stripComments(src)).toContain('chartOrderScope(salesOrders')
    expect(stripComments(src)).toContain('includeCancelled: true')

    // And it must SAY why, or the next reader "completes" the fix and deletes
    // the cancelled bucket from the status chart.
    expect(src.toLowerCase()).toContain('groups by status')
  })
})
