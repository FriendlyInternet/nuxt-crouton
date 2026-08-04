/**
 * KDS read model — live order tickets per location (#61, decoupled KDS).
 *
 * The kitchen display is a standalone view, not a printer: it reads the event's
 * orders directly and splits each into one ticket per location (an order's fries
 * go to the kitchen screen, its beer to the bar screen). It does NOT touch
 * `salesPrintqueues` — printers and screens are independent consumers of the
 * same per-location order stream.
 *
 * A ticket is keyed by `(order × location)` so the kitchen and bar screens clear
 * the same order independently; "done" lives in `salesKdsbumps`, one row per
 * cleared `(order, location)`. Bumping never changes the order's own status —
 * order lifecycle is separate from what a screen shows.
 *
 * Query: `?locations=locA,locB` scopes to the block's configured locations
 * (empty = every location in the event). Auth: none — an unattended screen on
 * the trusted venue LAN (the page gate guards access); a helper-scoped token is
 * a follow-up.
 *
 * ## One query, bounded parameters (#1766)
 *
 * This used to fetch EVERY non-cancelled order in the event and then discard the
 * bumped ones in JavaScript, binding one parameter per order id via `inArray`.
 * D1 rejects a query over 100 bound parameters, so the board broke — silently,
 * permanently — once an event passed ~100 orders. Local SQLite allows 32 766, so
 * it could only ever fail in production.
 *
 * The bump exclusion now lives in SQL (`LEFT JOIN … WHERE bump IS NULL`), so the
 * read is O(open tickets) rather than O(event) and carries no order-id list at
 * all. What it binds is fixed by the operator's configuration, not by how long
 * the night has been. Plan + shaper: `server/utils/kds-tickets.ts`.
 *
 * Reads the consuming app's generated `sales` layer schemas (the package ships
 * the logic; the app owns the tables).
 */
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesKdsbumps } from '~~/layers/sales/collections/kdsbumps/server/database/schema'
import { salesLocations } from '~~/layers/sales/collections/locations/server/database/schema'
import {
  planDisplayJobsQuery,
  shapeDisplayTickets,
  type TicketRow
} from '../../../../../utils/kds-tickets'

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'eventId is required' })
  }

  const requested = (getQuery(event).locations as string | undefined)
    ?.split(',').map(s => s.trim()).filter(Boolean) ?? []

  let plan
  try {
    plan = planDisplayJobsQuery({ eventId, locations: requested })
  }
  catch (error: any) {
    // A misconfigured block fails here with a real message, rather than as an
    // opaque 500 from D1 that the board would silently swallow (#1766).
    throw createError({ status: 400, statusText: error?.message ?? 'Invalid display query' })
  }

  const db = useDB()

  // Item-driven, so location routing is a column rather than a second pass. The
  // bump LEFT JOIN is what keeps this to open tickets only; the products join is
  // LEFT so a deleted product surfaces as unroutable instead of vanishing. The
  // row limit bounds one runaway event.
  const rows = await db
    .select({
      orderId: salesOrders.id,
      productId: salesOrderitems.productId,
      eventOrderNumber: salesOrders.eventOrderNumber,
      clientName: salesOrders.clientName,
      isPersonnel: salesOrders.isPersonnel,
      createdAt: salesOrders.createdAt,
      locationId: salesProducts.locationId,
      productTitle: salesProducts.title,
      quantity: salesOrderitems.quantity,
      remarks: salesOrderitems.remarks
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderitems.orderId))
    .leftJoin(salesProducts, eq(salesProducts.id, salesOrderitems.productId))
    .leftJoin(salesLocations, eq(salesLocations.id, salesProducts.locationId))
    .leftJoin(salesKdsbumps, and(
      eq(salesKdsbumps.orderId, salesOrderitems.orderId),
      eq(salesKdsbumps.locationId, salesProducts.locationId)
    ))
    .where(and(
      eq(salesOrders.eventId, eventId),
      ne(salesOrders.status, 'cancelled'),
      isNull(salesKdsbumps.id),
      // A location that opted out of confirmation never reaches a screen — its
      // part is handed straight over (#1851). NULL predates the migration and
      // counts as requiring, so historical rows keep appearing.
      or(isNull(salesLocations.requiresHandover), eq(salesLocations.requiresHandover, true)),
      // Bounded by MAX_CONFIGURABLE_LOCATIONS, which the plan already enforced.
      plan.locations.length ? inArray(salesProducts.locationId, plan.locations) : undefined
    ))
    .orderBy(asc(salesOrders.createdAt))
    .limit(plan.limit)

  const { tickets, unroutable } = shapeDisplayTickets(rows as TicketRow[])

  if (unroutable.length > 0) {
    // An item with no prep location reaches no station — malformed data, not a
    // kitchen's problem (kassa's products schema never marked `locationId`
    // required, #1769). It must not vanish without a trace, so it is logged and
    // counted rather than dropped on the floor as it used to be.
    console.warn(
      `[kds] ${unroutable.length} item(s) in event ${eventId} have no prep location and reach no screen`,
      unroutable
    )
  }

  return { jobs: tickets, unroutableCount: unroutable.length }
})
