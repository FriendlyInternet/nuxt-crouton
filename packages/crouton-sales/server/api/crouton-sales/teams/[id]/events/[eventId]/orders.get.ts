/**
 * @crouton-package crouton-sales
 * @description Team-authed, filtered + paginated orders list for the register's
 * "Bestellingen" pane (`OrdersTab`). The sales-specific filters — helper
 * (`owner`), printer and print status — need logic the generic CRUD generator
 * can't produce (printer/status match the shared crouton-printing `print_jobs`
 * queue via a correlated EXISTS), so the query lives in the package rather than
 * in per-app generated code where it silently went missing (the "filters do
 * nothing" bug). Mirrors the bookings `admin-bookings` pattern: the package
 * owns the query, the app owns the tables (imported via `~~/layers/...`).
 *
 * Request-shaping is the pure, unit-tested `order-filters` util; this handler
 * stays a thin fetch → build-where → delegate, matching `my-orders`. Returns
 * the slim shape OrdersTab renders — the expand panel fetches its own line
 * items and the row LEDs come from the `printqueues/status` poll, so the heavy
 * joins the generated collection GET does aren't needed here.
 */
import { and, desc, eq, exists, inArray, ne, sql } from 'drizzle-orm'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { requireTeamEvent } from '../../../../../../utils/team-event'
import { planOutstandingCount } from '../../../../../../utils/pass-tickets'
import { locationBlocksDeliverySql } from '../../../../../../utils/location-handover'
import {
  parseLocationRemarks,
  parseOrderFilters,
  parsePageParams,
  printStatusBucket,
  type OrderFilters
} from '../../../../../../utils/order-filters'

// Correlated EXISTS over this order's sales print jobs (refType='order',
// refId=order.id). `salesOrders` is the app's generated table.
function orderHasJob(db: any, salesOrders: any, extra: any) {
  return exists(
    db.select({ one: sql`1` }).from(printJobs).where(and(
      eq(printJobs.source, 'sales'),
      eq(printJobs.refType, 'order'),
      eq(printJobs.refId, salesOrders.id),
      extra
    ))
  )
}

// The printer + print-status filters both match against the shared
// crouton-printing queue — the part the generic CRUD generator can't produce.
function jobFilterConditions(db: any, salesOrders: any, f: OrderFilters) {
  const bucket = printStatusBucket(f.printStatus)
  return [
    f.printerId ? orderHasJob(db, salesOrders, eq(printJobs.printerId, f.printerId)) : undefined,
    bucket ? orderHasJob(db, salesOrders, inArray(printJobs.status, bucket)) : undefined
  ].filter(Boolean)
}

// Backlog-only (#1846, re-fixed #1875): the same rule `countOutstanding` uses,
// applied to the LIST via `?outstanding=1`. A correlated EXISTS rather than a
// join, so it composes with the other filters without changing the row shape
// or duplicating rows. Keyed on `salesKdsbumps`, mirroring `countOutstanding`
// below: an order still has items "in bereiding" when at least one location
// that requires confirmation (`requiresHandover` true or NULL — NULL predates
// the migration and counts as requiring) has no matching bump. Only scopes to
// not-cancelled when this filter is active — the unfiltered list still shows
// cancelled orders, matching prior behavior.
async function outstandingCondition(db: any, salesOrders: any) {
  const { salesOrderitems } = await import('~~/layers/sales/collections/orderitems/server/database/schema')
  const { salesProducts } = await import('~~/layers/sales/collections/products/server/database/schema')
  const { salesLocations } = await import('~~/layers/sales/collections/locations/server/database/schema')
  const { salesKdsbumps } = await import('~~/layers/sales/collections/kdsbumps/server/database/schema')

  return and(
    ne(salesOrders.status, 'cancelled'),
    exists(
      db.select({ one: sql`1` })
        .from(salesOrderitems)
        .innerJoin(salesProducts, eq(salesProducts.id, salesOrderitems.productId))
        .innerJoin(salesLocations, eq(salesLocations.id, salesProducts.locationId))
        .leftJoin(salesKdsbumps, and(
          eq(salesKdsbumps.orderId, salesOrderitems.orderId),
          eq(salesKdsbumps.locationId, salesProducts.locationId)
        ))
        .where(and(
          eq(salesOrderitems.orderId, salesOrders.id),
          locationBlocksDeliverySql({
            bumpId: salesKdsbumps.id,
            requiresHandover: salesLocations.requiresHandover
          })
        ))
    )
  )
}

// Shared WHERE for both the list and the count so a filtered page and its total
// stay in sync. Column-equality filters here; print-job EXISTS filters above.
// owner stores the helper displayName (stable across logins) — what the
// OrdersTab helper filter sends. Undefined filters drop out via .filter().
async function buildWhere(db: any, salesOrders: any, teamId: string, eventId: string, f: OrderFilters) {
  return and(
    eq(salesOrders.teamId, teamId),
    eq(salesOrders.eventId, eventId),
    ...[
      f.owner ? eq(salesOrders.owner, f.owner) : undefined,
      f.clientId ? eq(salesOrders.clientId, f.clientId) : undefined,
      f.outstanding ? await outstandingCondition(db, salesOrders) : undefined
    ].filter(Boolean),
    ...jobFilterConditions(db, salesOrders, f)
  )
}

/**
 * "Still waiting" — orders not cancelled and not yet handed to a customer (#1763).
 *
 * NOTE the separate scope: this deliberately does NOT reuse `buildWhere`. That
 * one is filter-aware so a page and its total agree; a backlog figure that
 * shrank when you picked a helper from the dropdown would be
 * authoritative-looking and wrong. `planOutstandingCount` cannot receive a
 * filter, which is what keeps the two apart.
 */
async function countOutstanding(db: any, salesOrders: any, teamId: string, eventId: string) {
  const plan = planOutstandingCount({ teamId, eventId })
  const { salesOrderitems } = await import('~~/layers/sales/collections/orderitems/server/database/schema')
  const { salesProducts } = await import('~~/layers/sales/collections/products/server/database/schema')
  const { salesLocations } = await import('~~/layers/sales/collections/locations/server/database/schema')
  const { salesKdsbumps } = await import('~~/layers/sales/collections/kdsbumps/server/database/schema')

  // Still to deliver = at least one location that REQUIRES confirmation has no
  // bump (#1851). The rule is NOT spelled out here: it is the shared
  // `locationBlocksDeliverySql`, which the per-product view (#1867) also uses.
  // This query used to carry its own copy of the condition, so the pane counter
  // and anything else asking the same question could drift apart silently.
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${salesOrders.id})` })
    .from(salesOrders)
    .innerJoin(salesOrderitems, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesProducts.id, salesOrderitems.productId))
    .innerJoin(salesLocations, eq(salesLocations.id, salesProducts.locationId))
    .leftJoin(salesKdsbumps, and(
      eq(salesKdsbumps.orderId, salesOrders.id),
      eq(salesKdsbumps.locationId, salesProducts.locationId)
    ))
    .where(and(
      eq(salesOrders.teamId, plan.teamId),
      eq(salesOrders.eventId, plan.eventId),
      ne(salesOrders.status, 'cancelled'),
      locationBlocksDeliverySql({
        bumpId: salesKdsbumps.id,
        requiresHandover: salesLocations.requiresHandover
      })
    ))

  return Number(row?.count ?? 0)
}

export default defineEventHandler(async (event) => {
  const { team, db, eventId } = await requireTeamEvent(event)
  const { salesOrders } = await import('~~/layers/sales/collections/orders/server/database/schema')

  const query = getQuery(event)
  const filters = parseOrderFilters(query)
  const { page, pageSize, offset } = parsePageParams(query)
  const whereExpr = await buildWhere(db, salesOrders, team.id, eventId, filters)

  const rows = await (db as any)
    .select({
      id: salesOrders.id,
      eventOrderNumber: salesOrders.eventOrderNumber,
      clientName: salesOrders.clientName,
      clientId: salesOrders.clientId,
      owner: salesOrders.owner,
      overallRemarks: salesOrders.overallRemarks,
      locationRemarks: salesOrders.locationRemarks,
      isPersonnel: salesOrders.isPersonnel,
      status: salesOrders.status,
      createdAt: salesOrders.createdAt
    })
    .from(salesOrders)
    .where(whereExpr)
    .orderBy(desc(salesOrders.createdAt))
    .limit(pageSize)
    .offset(offset)

  const [countRow] = await (db as any)
    .select({ count: sql<number>`count(*)` })
    .from(salesOrders)
    .where(whereExpr)

  return {
    items: parseLocationRemarks(rows),
    total: Number(countRow?.count ?? 0),
    outstanding: await countOutstanding(db, salesOrders, team.id, eventId),
    page,
    pageSize
  }
})
