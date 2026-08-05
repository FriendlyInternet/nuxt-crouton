/**
 * The orders-list "in bereiding" filter — `outstandingOrdersCondition` (#1875).
 *
 * ## Why this file exists
 *
 * The chip above the Bestellingen list reads "N in bereiding" and toggles
 * `?outstanding=1`. For two releases that toggle did NOTHING: it restyled,
 * refetched, and returned the identical list. #1846 built the filter keyed on
 * `salesHandovers`; #1851 replaced the pass model with per-location send-out,
 * re-pointed the COUNT onto `salesKdsbumps`, and left the LIST behind. The
 * client still sent the param, `order-filters` still parsed it, and the comment
 * above `buildWhere` still described a `NOT EXISTS` that was no longer there —
 * so everything read as implemented.
 *
 * Nothing caught it: the count has its own test, `order-filters` covers only
 * request shaping, and a missing WHERE clause breaks no build. These cases are
 * the guard — they assert the LIST answers the same sentence as the count.
 *
 * The tables are parameters (see `OutstandingOrderTables`), which is the only
 * reason this is reachable from a package test at all — in the endpoint they
 * come from `~~/layers/sales/...`, an alias that resolves only inside an app.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

import { outstandingOrdersCondition, OUTSTANDING_DEFINITION } from '../server/utils/pass-tickets'

// Local-only, and a known gap rather than a preference: every ci.yml job installs with
// `pnpm install --ignore-scripts`, so better-sqlite3's native binding is never built and
// `new Database()` throws "Could not locate the bindings file". Same guard, same reason as
// `per-product-totals.test.ts`; #1880 fixes CI and removes both. Until then run these
// locally before touching the outstanding rule.
const describeLocal = describe.skipIf(process.env.CI)

// Minimal mirrors of the generated tables — only the columns the predicate reads.
const orders = sqliteTable('sales_orders', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  eventId: text('eventId').notNull(),
  status: text('status'),
  owner: text('owner')
})
const orderitems = sqliteTable('sales_orderitems', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  productId: text('productId').notNull(),
  quantity: real('quantity').notNull()
})
const products = sqliteTable('sales_products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  locationId: text('locationId')
})
const locations = sqliteTable('sales_locations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  requiresHandover: integer('requiresHandover', { mode: 'boolean' })
})
const kdsbumps = sqliteTable('sales_kdsbumps', {
  id: text('id').primaryKey(),
  orderId: text('orderId').notNull(),
  locationId: text('locationId').notNull()
})

const tables = { orders, orderitems, products, locations, kdsbumps }

const DDL = [
  `CREATE TABLE sales_orders (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, eventId TEXT NOT NULL, status TEXT, owner TEXT)`,
  `CREATE TABLE sales_orderitems (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, productId TEXT NOT NULL, quantity REAL NOT NULL)`,
  `CREATE TABLE sales_products (id TEXT PRIMARY KEY, title TEXT NOT NULL, locationId TEXT)`,
  `CREATE TABLE sales_locations (id TEXT PRIMARY KEY, title TEXT NOT NULL, requiresHandover INTEGER)`,
  `CREATE TABLE sales_kdsbumps (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, locationId TEXT NOT NULL)`
]

const TEAM = 'team-1'
const EVENT = 'event-1'

let db: ReturnType<typeof drizzle>

/** Insert one order with a line at each named location. */
function seedOrder(id: string, locationIds: string[], opts: { status?: string, owner?: string } = {}) {
  db.insert(orders).values({
    id, teamId: TEAM, eventId: EVENT, status: opts.status ?? 'pending', owner: opts.owner ?? 'ann'
  }).run()
  locationIds.forEach((loc, i) => {
    db.insert(orderitems).values({ id: `${id}-i${i}`, orderId: id, productId: `p-${loc}`, quantity: 1 }).run()
  })
}

/** Run the filter the way `buildWhere` does and return the matching order ids. */
function outstandingIds(extra?: any) {
  const rows = db.select({ id: orders.id }).from(orders).where(and(
    eq(orders.teamId, TEAM),
    eq(orders.eventId, EVENT),
    outstandingOrdersCondition(db, tables),
    ...(extra ? [extra] : [])
  )).all()
  return rows.map(r => r.id).sort()
}

beforeEach(() => {
  const sqlite = new Database(':memory:')
  for (const stmt of DDL) sqlite.exec(stmt)
  db = drizzle(sqlite)

  // Three locations covering the whole requiresHandover domain. `null` is not a
  // curiosity — it is what every pre-migration row reads, and treating it as
  // "nothing to confirm" would mark historical orders delivered on sight.
  db.insert(locations).values([
    { id: 'kitchen', title: 'Kitchen', requiresHandover: true },
    { id: 'bar', title: 'Bar', requiresHandover: false },
    { id: 'legacy', title: 'Legacy', requiresHandover: null }
  ]).run()
  db.insert(products).values([
    { id: 'p-kitchen', title: 'Fries', locationId: 'kitchen' },
    { id: 'p-bar', title: 'Beer', locationId: 'bar' },
    { id: 'p-legacy', title: 'Old', locationId: 'legacy' }
  ]).run()
})

describeLocal('outstandingOrdersCondition — the list answers the same sentence as the count', () => {
  it('keeps an order whose requiring location has no bump', () => {
    seedOrder('o1', ['kitchen'])
    expect(outstandingIds()).toEqual(['o1'])
  })

  it('drops an order once every requiring location has bumped', () => {
    seedOrder('o1', ['kitchen'])
    db.insert(kdsbumps).values({ id: 'b1', orderId: 'o1', locationId: 'kitchen' }).run()
    expect(outstandingIds()).toEqual([])
  })

  it('still holds an order open while only SOME of its locations have bumped', () => {
    // The half-delivered case — the one a naive "has any bump" check gets wrong.
    seedOrder('o1', ['kitchen', 'legacy'])
    db.insert(kdsbumps).values({ id: 'b1', orderId: 'o1', locationId: 'kitchen' }).run()
    expect(outstandingIds()).toEqual(['o1'])
  })

  it('never lets an opt-out location hold an order open', () => {
    // requiresHandover=false: nobody confirms send-out there, so an unbumped bar
    // line must not park the order in the backlog forever.
    seedOrder('o1', ['bar'])
    expect(outstandingIds()).toEqual([])
  })

  it('treats a NULL requiresHandover as REQUIRING confirmation', () => {
    // Pre-migration rows. Reading NULL as "opted out" would empty the backlog
    // for every historical order at once.
    seedOrder('o1', ['legacy'])
    expect(outstandingIds()).toEqual(['o1'])
  })

  it('excludes cancelled orders, matching OUTSTANDING_DEFINITION', () => {
    seedOrder('o1', ['kitchen'], { status: 'cancelled' })
    seedOrder('o2', ['kitchen'])
    expect(OUTSTANDING_DEFINITION.excludesCancelled).toBe(true)
    expect(outstandingIds()).toEqual(['o2'])
  })

  it('composes with another filter and returns each order exactly once', () => {
    // A correlated EXISTS, not a join: an order with TWO unbumped requiring
    // locations must appear once, not twice. A join here would duplicate the row
    // and silently inflate the paginated total.
    seedOrder('o1', ['kitchen', 'legacy'], { owner: 'ann' })
    seedOrder('o2', ['kitchen'], { owner: 'bob' })
    expect(outstandingIds()).toEqual(['o1', 'o2'])
    expect(outstandingIds(eq(orders.owner, 'ann'))).toEqual(['o1'])
  })

  it('leaves the unfiltered list alone — cancelled orders still show without the filter', () => {
    // Cancelled is excluded by THIS filter, not globally. The Bestellingen list
    // without the chip must still show a cancelled order.
    seedOrder('o1', ['kitchen'], { status: 'cancelled' })
    const all = db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.teamId, TEAM), eq(orders.eventId, EVENT))).all()
    expect(all.map(r => r.id)).toEqual(['o1'])
    expect(outstandingIds()).toEqual([])
  })

  it('scopes to the team, so one venue cannot read another', () => {
    seedOrder('o1', ['kitchen'])
    db.insert(orders).values({
      id: 'other', teamId: 'team-2', eventId: EVENT, status: 'pending', owner: 'zed'
    }).run()
    db.insert(orderitems).values({ id: 'other-i0', orderId: 'other', productId: 'p-kitchen', quantity: 1 }).run()
    expect(outstandingIds()).toEqual(['o1'])
  })
})
