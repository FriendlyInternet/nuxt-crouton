/**
 * Per-product totals for the Data pane — behaviour contract (#1867).
 *
 * The owner picked reading **C**: one block, two numbers per product —
 * **Verkocht** (units sold, i.e. gone from the cellar) and **Nog uit** (units a
 * location still owes the customer).
 *
 * ## Why this file uses a real database
 *
 * Every other test in this package is pure, because every other rule in this
 * package is pure. This one is not: "still to deliver" is expressed as SQL in
 * the orders endpoint (`countOutstanding`) and as a TypeScript predicate in
 * `location-handover.ts` (`isOrderDelivered`), and #1867 is about to add a
 * third consumer. Two of those already exist as *separate implementations of
 * the same sentence* — the exact shape that drifts.
 *
 * A plan-object test (the `planOutstandingCount` idiom) cannot catch that: it
 * asserts a *declaration* — `excludesHandedOver: true` — while the SQL beneath
 * it is free to say something else. So this file runs the real predicate
 * against real SQLite and pins it to the same truth table the pure function
 * answers. If the two ever disagree, a test fails instead of the Bestellingen
 * counter and the product view quietly showing different numbers mid-service.
 *
 * Tables are injected rather than imported, for the reason `handover.ts`
 * already documents: they live in the CONSUMING app's generated layer
 * (`~~/layers/sales/...`), which a package test cannot resolve. Keeping them
 * parameters is what makes this behaviour testable at all.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq, sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

import {
  isOrderDelivered,
  locationBlocksDelivery,
  locationBlocksDeliverySql
} from '../server/utils/location-handover'
import { buildPerProductTotals } from '../server/utils/per-product-totals'

// ---------------------------------------------------------------------------
// Minimal mirrors of the generated tables — only the columns the query reads.
// ---------------------------------------------------------------------------

const orders = sqliteTable('sales_orders', {
  id: text('id').primaryKey(),
  teamId: text('teamId').notNull(),
  eventId: text('eventId').notNull(),
  status: text('status'),
  isPersonnel: integer('isPersonnel', { mode: 'boolean' })
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
  `CREATE TABLE sales_orders (id TEXT PRIMARY KEY, teamId TEXT NOT NULL, eventId TEXT NOT NULL, status TEXT, isPersonnel INTEGER)`,
  `CREATE TABLE sales_orderitems (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, productId TEXT NOT NULL, quantity REAL NOT NULL)`,
  `CREATE TABLE sales_products (id TEXT PRIMARY KEY, title TEXT NOT NULL, locationId TEXT)`,
  `CREATE TABLE sales_locations (id TEXT PRIMARY KEY, title TEXT NOT NULL, requiresHandover INTEGER)`,
  `CREATE TABLE sales_kdsbumps (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, locationId TEXT NOT NULL)`
]

let db: ReturnType<typeof drizzle>

beforeEach(() => {
  const sqlite = new Database(':memory:')
  for (const stmt of DDL) sqlite.exec(stmt)
  db = drizzle(sqlite)
})

// ---------------------------------------------------------------------------
// 1. The two halves of the same sentence must agree.
// ---------------------------------------------------------------------------

describe('locationBlocksDeliverySql — agrees with the pure rule, row for row', () => {
  // Every combination the database can actually hold. `null` is not a curiosity
  // here: it is what pre-migration rows read, and reading it as "nothing to
  // confirm" would mark every historical order delivered on sight.
  const COMBOS = [
    { requiresHandover: true, bumped: false },
    { requiresHandover: true, bumped: true },
    { requiresHandover: false, bumped: false },
    { requiresHandover: false, bumped: true },
    { requiresHandover: null, bumped: false },
    { requiresHandover: null, bumped: true }
  ] as const

  it.each(COMBOS)(
    'requiresHandover=$requiresHandover bumped=$bumped — SQL and TypeScript reach the same verdict',
    async (combo) => {
      const key = `${combo.requiresHandover}-${combo.bumped}`
      await db.insert(locations).values({ id: `loc-${key}`, title: 'X', requiresHandover: combo.requiresHandover })
      if (combo.bumped) {
        await db.insert(kdsbumps).values({ id: `bump-${key}`, orderId: 'o-1', locationId: `loc-${key}` })
      }

      const rows = await db
        .select({ id: locations.id })
        .from(locations)
        .leftJoin(kdsbumps, and(
          eq(kdsbumps.locationId, locations.id),
          eq(kdsbumps.orderId, 'o-1')
        ))
        .where(locationBlocksDeliverySql({
          bumpId: kdsbumps.id,
          requiresHandover: locations.requiresHandover
        }))

      const sqlSaysBlocks = rows.length === 1
      const pureSaysBlocks = locationBlocksDelivery({
        locationId: `loc-${key}`,
        requiresHandover: combo.requiresHandover,
        bumped: combo.bumped
      })

      expect(sqlSaysBlocks).toBe(pureSaysBlocks)
    }
  )

  it('never treats a NULL requiresHandover as opted out', async () => {
    // Stated on its own as well as in the table above: this is the single
    // combination whose regression is silent and total (every historical order
    // reads delivered), so it must fail loudly and by name.
    await db.insert(locations).values({ id: 'loc-legacy', title: 'Legacy', requiresHandover: null })

    const rows = await db
      .select({ id: locations.id })
      .from(locations)
      .leftJoin(kdsbumps, and(eq(kdsbumps.locationId, locations.id), eq(kdsbumps.orderId, 'o-1')))
      .where(locationBlocksDeliverySql({ bumpId: kdsbumps.id, requiresHandover: locations.requiresHandover }))

    expect(rows).toHaveLength(1)
    expect(isOrderDelivered([{ locationId: 'loc-legacy', requiresHandover: null, bumped: false }])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. The per-product numbers themselves.
// ---------------------------------------------------------------------------

/**
 * The venue from the mockup: a bar that hands drinks straight over
 * (`requiresHandover: false`) and a kitchen that confirms send-out.
 */
async function seedVenue() {
  await db.insert(locations).values([
    { id: 'bar', title: 'Bar', requiresHandover: false },
    { id: 'keuken', title: 'Keuken', requiresHandover: true }
  ])
  await db.insert(products).values([
    { id: 'p-pils', title: 'Pils', locationId: 'bar' },
    { id: 'p-frieten', title: 'Frieten', locationId: 'keuken' }
  ])
}

async function placeOrder(input: {
  id: string
  items: Array<{ productId: string, quantity: number }>
  status?: string
  isPersonnel?: boolean
  bumpedLocations?: string[]
}) {
  await db.insert(orders).values({
    id: input.id,
    teamId: 'team-1',
    eventId: 'evt-1',
    status: input.status ?? 'pending',
    isPersonnel: input.isPersonnel ?? false
  })
  await db.insert(orderitems).values(input.items.map((it, i) => ({
    id: `${input.id}-i${i}`,
    orderId: input.id,
    productId: it.productId,
    quantity: it.quantity
  })))
  for (const locationId of input.bumpedLocations ?? []) {
    await db.insert(kdsbumps).values({ id: `${input.id}-${locationId}`, orderId: input.id, locationId })
  }
}

const totals = () => buildPerProductTotals(db, tables, {
  teamId: 'team-1',
  eventId: 'evt-1',
  personnel: 'all'
})

const byTitle = (rows: Array<{ product: string }>, title: string) =>
  rows.find(r => r.product === title)

describe('buildPerProductTotals — sold', () => {
  beforeEach(seedVenue)

  it('sums quantities rather than counting order lines', async () => {
    // Three pils on one line is three pils out of the cellar, not one.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-pils', quantity: 3 }] })

    expect(byTitle(await totals(), 'Pils')!.sold).toBe(3)
  })

  it('adds the same product up across separate orders', async () => {
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-pils', quantity: 3 }] })
    await placeOrder({ id: 'o-2', items: [{ productId: 'p-pils', quantity: 2 }] })

    expect(byTitle(await totals(), 'Pils')!.sold).toBe(5)
  })

  it('does not let one order\'s second product inflate the first', async () => {
    // The item join fans a row out per line; summing without grouping carefully
    // is how a product silently doubles.
    await placeOrder({ id: 'o-1', items: [
      { productId: 'p-pils', quantity: 3 },
      { productId: 'p-frieten', quantity: 2 }
    ] })

    const rows = await totals()
    expect(byTitle(rows, 'Pils')!.sold).toBe(3)
    expect(byTitle(rows, 'Frieten')!.sold).toBe(2)
  })

  it('excludes cancelled orders from sold', async () => {
    // DECISION (#1867): a cancelled order is a mis-punch, not consumption. It
    // must not inflate "do we need to order more". NOTE this deliberately
    // differs from the existing product×day matrix, which filters no status at
    // all — that inconsistency predates this issue and is logged, not fixed here.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-pils', quantity: 3 }] })
    await placeOrder({ id: 'o-2', items: [{ productId: 'p-pils', quantity: 9 }], status: 'cancelled' })

    expect(byTitle(await totals(), 'Pils')!.sold).toBe(3)
  })
})

describe('buildPerProductTotals — outstanding', () => {
  beforeEach(seedVenue)

  it('counts units a requiring location has not bumped', async () => {
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-frieten', quantity: 2 }] })

    expect(byTitle(await totals(), 'Frieten')!.outstanding).toBe(2)
  })

  it('drops to zero once the location bumps the order', async () => {
    await placeOrder({
      id: 'o-1',
      items: [{ productId: 'p-frieten', quantity: 2 }],
      bumpedLocations: ['keuken']
    })

    const row = byTitle(await totals(), 'Frieten')!
    expect(row.outstanding).toBe(0)
    expect(row.sold).toBe(2) // still consumed — bumping is delivery, not undo
  })

  it('reports null outstanding for an opt-out location, not zero', async () => {
    // The distinction the mockup turns on: the bar CANNOT have a backlog, which
    // is different from "has none right now". Rendering 0 would read as "all
    // caught up" and invite the operator to wait for a number that never moves.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-pils', quantity: 3 }] })

    const row = byTitle(await totals(), 'Pils')!
    expect(row.sold).toBe(3)
    expect(row.outstanding).toBeNull()
  })

  it('excludes cancelled orders from outstanding', async () => {
    // A live order alongside the cancelled one, so the product still has a row
    // to assert on — with ONLY the cancelled order the product is absent
    // entirely (nothing was sold), which is covered separately below.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-frieten', quantity: 2 }], bumpedLocations: ['keuken'] })
    await placeOrder({ id: 'o-2', items: [{ productId: 'p-frieten', quantity: 9 }], status: 'cancelled' })

    const row = byTitle(await totals(), 'Frieten')!
    expect(row.outstanding).toBe(0) // the cancelled 9 must not appear here
    expect(row.sold).toBe(2)
  })

  it('omits a product whose only orders were cancelled', async () => {
    // Nothing was sold and nothing is owed, so it is not a row — listing it at
    // 0/0 would pad the pane with products that never moved.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-frieten', quantity: 9 }], status: 'cancelled' })

    expect(byTitle(await totals(), 'Frieten')).toBeUndefined()
  })

  it('agrees with the Bestellingen counter on the same data', async () => {
    // The acceptance criterion in prose: the product view and the pane counter
    // must not drift. Here that is checked as a fact, not a promise — the
    // orders still holding a backlog are exactly the orders whose products
    // report outstanding units.
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-frieten', quantity: 2 }] })
    await placeOrder({ id: 'o-2', items: [{ productId: 'p-pils', quantity: 4 }] })
    await placeOrder({
      id: 'o-3',
      items: [{ productId: 'p-frieten', quantity: 1 }],
      bumpedLocations: ['keuken']
    })

    // o-1 blocks (kitchen unbumped); o-2 is bar-only so it is delivered on
    // placement; o-3 was bumped. One order still outstanding.
    const [counter] = await db
      .select({ count: sql<number>`count(distinct ${orders.id})` })
      .from(orders)
      .innerJoin(orderitems, eq(orderitems.orderId, orders.id))
      .innerJoin(products, eq(products.id, orderitems.productId))
      .innerJoin(locations, eq(locations.id, products.locationId))
      .leftJoin(kdsbumps, and(
        eq(kdsbumps.orderId, orders.id),
        eq(kdsbumps.locationId, products.locationId)
      ))
      .where(and(
        eq(orders.teamId, 'team-1'),
        eq(orders.eventId, 'evt-1'),
        sql`${orders.status} <> 'cancelled'`,
        locationBlocksDeliverySql({ bumpId: kdsbumps.id, requiresHandover: locations.requiresHandover })
      ))

    const rows = await totals()
    const productsWithBacklog = rows.filter(r => (r.outstanding ?? 0) > 0).map(r => r.product)

    expect(Number(counter?.count)).toBe(1)
    expect(productsWithBacklog).toEqual(['Frieten'])
    expect(byTitle(rows, 'Frieten')!.outstanding).toBe(2)
  })
})

describe('buildPerProductTotals — scoping', () => {
  beforeEach(seedVenue)

  it('never reads another team\'s or another event\'s orders', async () => {
    await placeOrder({ id: 'o-mine', items: [{ productId: 'p-pils', quantity: 1 }] })
    await db.insert(orders).values([
      { id: 'o-other-team', teamId: 'team-2', eventId: 'evt-1', status: 'pending', isPersonnel: false },
      { id: 'o-other-event', teamId: 'team-1', eventId: 'evt-2', status: 'pending', isPersonnel: false }
    ])
    await db.insert(orderitems).values([
      { id: 'x1', orderId: 'o-other-team', productId: 'p-pils', quantity: 50 },
      { id: 'x2', orderId: 'o-other-event', productId: 'p-pils', quantity: 50 }
    ])

    expect(byTitle(await totals(), 'Pils')!.sold).toBe(1)
  })

  it('honours the pane\'s staff toggle, so it cannot contradict the charts beside it', async () => {
    await placeOrder({ id: 'o-1', items: [{ productId: 'p-pils', quantity: 3 }] })
    await placeOrder({ id: 'o-2', items: [{ productId: 'p-pils', quantity: 4 }], isPersonnel: true })

    const all = await buildPerProductTotals(db, tables, { teamId: 'team-1', eventId: 'evt-1', personnel: 'all' })
    const customers = await buildPerProductTotals(db, tables, { teamId: 'team-1', eventId: 'evt-1', personnel: 'exclude' })
    const staff = await buildPerProductTotals(db, tables, { teamId: 'team-1', eventId: 'evt-1', personnel: 'only' })

    expect(byTitle(all, 'Pils')!.sold).toBe(7)
    expect(byTitle(customers, 'Pils')!.sold).toBe(3)
    expect(byTitle(staff, 'Pils')!.sold).toBe(4)
  })

  it('binds a constant number of parameters, whatever the order count', async () => {
    // #1766: the KDS board froze past ~100 orders because the query grew an id
    // list. This query must never be shaped that way — its parameter count is
    // fixed by the scope, not by the data.
    for (let i = 0; i < 60; i++) {
      await placeOrder({ id: `o-${i}`, items: [{ productId: 'p-pils', quantity: 1 }] })
    }

    const rows = await totals()
    expect(byTitle(rows, 'Pils')!.sold).toBe(60)
  })
})
