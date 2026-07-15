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
import { and, desc, eq, exists, inArray, sql } from 'drizzle-orm'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { requireTeamEvent } from '../../../../../../utils/team-event'
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

// Shared WHERE for both the list and the count so a filtered page and its total
// stay in sync. Column-equality filters here; print-job EXISTS filters above.
// owner stores the helper displayName (stable across logins) — what the
// OrdersTab helper filter sends. Undefined filters drop out via .filter().
function buildWhere(db: any, salesOrders: any, teamId: string, eventId: string, f: OrderFilters) {
  return and(
    eq(salesOrders.teamId, teamId),
    eq(salesOrders.eventId, eventId),
    ...[
      f.owner ? eq(salesOrders.owner, f.owner) : undefined,
      f.clientId ? eq(salesOrders.clientId, f.clientId) : undefined
    ].filter(Boolean),
    ...jobFilterConditions(db, salesOrders, f)
  )
}

export default defineEventHandler(async (event) => {
  const { team, db, eventId } = await requireTeamEvent(event)
  const { salesOrders } = await import('~~/layers/sales/collections/orders/server/database/schema')

  const query = getQuery(event)
  const filters = parseOrderFilters(query)
  const { page, pageSize, offset } = parsePageParams(query)
  const whereExpr = buildWhere(db, salesOrders, team.id, eventId, filters)

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

  return { items: parseLocationRemarks(rows), total: Number(countRow?.count ?? 0), page, pageSize }
})
