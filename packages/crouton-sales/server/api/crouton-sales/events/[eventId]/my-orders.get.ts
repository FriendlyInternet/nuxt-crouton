/**
 * Helper-authenticated "my orders" list.
 *
 * Returns the orders the *active user* placed for this event, newest first,
 * each with its line items (product title + resolved option labels) and a
 * combined print-status bucket. This is the volunteer/admin-facing counterpart
 * of the team-authed workspace "Bestellingen" pane (OrdersTab), which a helper
 * token can't reach — it powers the POS order-history slideover.
 *
 * "This person" is keyed on `salesOrders.owner` (the helper displayName stamped
 * at checkout, `orders/index.post.ts`), which is stable across logins — the
 * same key OrdersTab's helper filter uses. `createdBy` is the scoped-token id,
 * which rotates every login, so it can't identify a person across sessions.
 *
 * The auth preamble lives in `requireScopedEvent` and the payload assembly in
 * the pure, unit-tested `shapeMyOrders` — this handler is just the queries.
 */
import { eq, and, inArray, desc } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { requireScopedEvent } from '../../../../utils/require-scoped-event'
import {
  shapeMyOrders,
  type MyOrderInput,
  type MyOrderItemInput,
  type MyOrderJobInput
} from '../../../../utils/my-orders-shape'

// Newest working set — a single person's orders over an event are bounded, but
// a multi-day event could accumulate many; the slideover is a recent history,
// not an archive.
const MAX_ORDERS = 100

export default defineEventHandler(async (event) => {
  const { eventId, access, db } = await requireScopedEvent(event)

  const orders = await db
    .select({
      id: salesOrders.id,
      eventOrderNumber: salesOrders.eventOrderNumber,
      clientName: salesOrders.clientName,
      overallRemarks: salesOrders.overallRemarks,
      isPersonnel: salesOrders.isPersonnel,
      status: salesOrders.status,
      createdAt: salesOrders.createdAt
    })
    .from(salesOrders)
    .where(and(
      eq(salesOrders.eventId, eventId),
      eq(salesOrders.owner, access.displayName)
    ))
    .orderBy(desc(salesOrders.createdAt))
    .limit(MAX_ORDERS) as MyOrderInput[]

  if (!orders.length) return []

  const orderIds = orders.map(o => o.id)

  // Items joined to their product (title + options), so the shaper can label
  // lines and resolve option ids without a second round-trip.
  const items = await db
    .select({
      id: salesOrderitems.id,
      orderId: salesOrderitems.orderId,
      quantity: salesOrderitems.quantity,
      unitPrice: salesOrderitems.unitPrice,
      totalPrice: salesOrderitems.totalPrice,
      remarks: salesOrderitems.remarks,
      selectedOptions: salesOrderitems.selectedOptions,
      productTitle: salesProducts.title,
      productOptions: salesProducts.options
    })
    .from(salesOrderitems)
    .leftJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(inArray(salesOrderitems.orderId, orderIds)) as MyOrderItemInput[]

  const jobs = await db
    .select({
      refId: printJobs.refId,
      status: printJobs.status,
      printMode: printJobs.printMode
    })
    .from(printJobs)
    .where(and(
      eq(printJobs.source, 'sales'),
      eq(printJobs.refType, 'order'),
      inArray(printJobs.refId, orderIds)
    )) as MyOrderJobInput[]

  return shapeMyOrders(orders, items, jobs)
})
