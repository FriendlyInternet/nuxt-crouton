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
import { and, desc, eq, exists, inArray, isNull, ne, sql } from 'drizzle-orm'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { requireTeamEvent } from '../../../../../../utils/team-event'
import { planOutstandingCount } from '../../../../../../utils/pass-tickets'
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

// Backlog-only (#1846): the same rule the count uses, applied to the LIST.
// A correlated NOT EXISTS rather than a join, so it composes with the other
// filters without changing the row shape or duplicating rows.
function outstandingConditions(salesOrders: any, f: OrderFilters, salesHandovers?: any) {
  if (!f.outstanding || !salesHandovers) return []
  return [
    ne(salesOrders.status, 'cancelled'),
    sql`not exists (select 1 from ${salesHandovers} where ${salesHandovers.orderId} = ${salesOrders.id})`
  ]
}

// Shared WHERE for both the list and the count so a filtered page and its total
// stay in sync. Column-equality filters here; print-job EXISTS filters above.
// owner stores the helper displayName (stable across logins) — what the
// OrdersTab helper filter sends. Undefined filters drop out via .filter().
function buildWhere(db: any, salesOrders: any, teamId: string, eventId: string, f: OrderFilters, salesHandovers?: any) {
  return and(
    eq(salesOrders.teamId, teamId),
    eq(salesOrders.eventId, eventId),
    ...outstandingConditions(salesOrders, f, salesHandovers),
    ...[
      f.owner ? eq(salesOrders.owner, f.owner) : undefined,
      f.clientId ? eq(salesOrders.clientId, f.clientId) : undefined
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
  const { salesHandovers } = await import('~~/layers/sales/collections/handovers/server/database/schema')

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salesOrders)
    .leftJoin(salesHandovers, eq(salesHandovers.orderId, salesOrders.id))
    .where(and(
      eq(salesOrders.teamId, plan.teamId),
      eq(salesOrders.eventId, plan.eventId),
      ne(salesOrders.status, 'cancelled'),
      isNull(salesHandovers.id)
    ))

  return Number(row?.count ?? 0)
}

export default defineEventHandler(async (event) => {
  const { team, db, eventId } = await requireTeamEvent(event)
  const { salesOrders } = await import('~~/layers/sales/collections/orders/server/database/schema')

  const query = getQuery(event)
  const filters = parseOrderFilters(query)
  const { page, pageSize, offset } = parsePageParams(query)
  // Loaded up-front because the backlog-only filter needs it in the WHERE.
  const { salesHandovers } = await import('~~/layers/sales/collections/handovers/server/database/schema')
  const whereExpr = buildWhere(db, salesOrders, team.id, eventId, filters, salesHandovers)

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
