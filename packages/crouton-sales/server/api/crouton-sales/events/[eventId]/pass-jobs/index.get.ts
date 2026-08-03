/**
 * Pass-screen read model — orders ready to hand to the customer (#1761).
 *
 * The second stage of the KDS loop (epic #1755). A station's READY press writes
 * a `sales_kdsbumps` row for one `(order × location)`; an order reaches the pass
 * only once EVERY location it touches has gone ready. Handing it over writes a
 * `sales_handovers` row, which this feed excludes on.
 *
 * Unlike `display-jobs`, tickets are NOT split by location — the runner carries
 * the whole order out, so one ticket per order with every line on it.
 *
 * Auth: none, matching the KDS endpoints — an unattended screen on the trusted
 * venue LAN (the page gate guards access); a helper-scoped token is a follow-up.
 *
 * ## Bounded parameters, by construction (#1766)
 *
 * The readiness rule is tempting to implement as: fetch the event's orders →
 * collect their ids → query bumps with `inArray(orderId, ids)`. That is exactly
 * what broke the KDS board — D1 rejects a query over 100 bound parameters, and
 * local SQLite (32 766) can never reproduce it. So this is ONE item-driven query
 * with the handover exclusion in SQL and no order-id list anywhere; readiness is
 * computed from the flat result by `shapePassTickets`.
 *
 * Reads the consuming app's generated `sales` layer schemas (the package ships
 * the logic; the app owns the tables).
 */
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesKdsbumps } from '~~/layers/sales/collections/kdsbumps/server/database/schema'
import { salesHandovers } from '~~/layers/sales/collections/handovers/server/database/schema'
import {
  planPassJobsQuery,
  shapePassTickets,
  type PassRow
} from '../../../../../utils/pass-tickets'

/**
 * The one query. Item-driven so location routing and bump state are columns
 * rather than extra round-trips: the handover LEFT JOIN + `IS NULL` keeps this
 * to orders still owed to a customer, and the bump LEFT JOIN carries
 * per-location readiness for the shaper to aggregate.
 */
async function fetchPassRows(db: any, eventId: string, limit: number) {
  return db
    .select({
      orderId: salesOrders.id,
      productId: salesOrderitems.productId,
      eventOrderNumber: salesOrders.eventOrderNumber,
      clientName: salesOrders.clientName,
      isPersonnel: salesOrders.isPersonnel,
      createdAt: salesOrders.createdAt,
      locationId: salesProducts.locationId,
      bumpId: salesKdsbumps.id,
      productTitle: salesProducts.title,
      quantity: salesOrderitems.quantity,
      remarks: salesOrderitems.remarks
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderitems.orderId))
    .leftJoin(salesProducts, eq(salesProducts.id, salesOrderitems.productId))
    .leftJoin(salesKdsbumps, and(
      eq(salesKdsbumps.orderId, salesOrderitems.orderId),
      eq(salesKdsbumps.locationId, salesProducts.locationId)
    ))
    .leftJoin(salesHandovers, eq(salesHandovers.orderId, salesOrders.id))
    .where(and(
      eq(salesOrders.eventId, eventId),
      ne(salesOrders.status, 'cancelled'),
      isNull(salesHandovers.id)
    ))
    .orderBy(asc(salesOrders.createdAt))
    .limit(limit)
}

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'eventId is required' })
  }

  const plan = planPassJobsQuery({ eventId })
  const rows = await fetchPassRows(useDB(), eventId, plan.limit)

  const { tickets, unroutable } = shapePassTickets(
    (rows as any[]).map(r => ({ ...r, bumped: r.bumpId != null })) as PassRow[]
  )

  if (unroutable.length > 0) {
    // An item with no prep location reaches no station, so no bump can ever
    // arrive for it. Readiness ignores those (otherwise the order would stall at
    // the pass forever — #1766's silent freeze one stage later), and the ticket
    // is flagged `incomplete` instead. Logged so the operator can fix the
    // product's Prep Location rather than discovering it at the customer.
    console.warn(
      `[pass] ${unroutable.length} item(s) in event ${eventId} have no prep location; their orders are offered as incomplete`,
      unroutable
    )
  }

  return { jobs: tickets, unroutableCount: unroutable.length }
})
