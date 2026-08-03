/**
 * Handover — record that an assembled order reached the customer (#1761).
 *
 * The write half of the pass screen, and the second stage of the KDS loop
 * (epic #1755): a station's bump says "my part is ready", this says "the whole
 * order is with the client". Outstanding orders are those with no row here.
 *
 * Body `{ orderId }`. Flat one-param route like `kds-bump`, for the same reason:
 * this app's router does not match a second path param under
 * `/events/:eventId/.../:param`, so the id rides the body rather than the path.
 *
 * Idempotent, and deliberately NOT the way `kds-bump` is. `sales_handovers`
 * carries a composite unique index on `(teamId, orderId)` (#1760), so a
 * check-then-insert would lose the race between two taps and raise a constraint
 * violation in the runner's face. `recordHandover` writes conflict-tolerantly
 * and treats a conflict as success — a second tap means "already handed over",
 * which is the outcome the runner wanted. A non-uniqueness failure still throws,
 * so a real error can never be mistaken for a completed handover.
 *
 * Does NOT touch `salesOrders.status`: that vocabulary already means something
 * else (`completed` = every print job succeeded, written by printing-reactions),
 * and order lifecycle is separate from delivery.
 *
 * Auth: none, matching the KDS endpoints — an unattended screen on the trusted
 * venue LAN; a helper-scoped token is a follow-up.
 */
import { and, eq } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesHandovers } from '~~/layers/sales/collections/handovers/server/database/schema'
import { readHandoverRequest, recordHandover } from '../../../../utils/handover'

/**
 * The order anchors the handover's tenant AND confirms it belongs to this
 * event — the same guard `kds-bump` applies, so an unauthed LAN screen can only
 * ever close out an order it is actually showing. 404 rather than a create.
 */
async function requireOrderInEvent(db: any, orderId: string, eventId: string) {
  const [order] = await db
    .select({ teamId: salesOrders.teamId, owner: salesOrders.owner })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.eventId, eventId)))
    .limit(1)

  if (!order) {
    throw createError({ status: 404, statusText: 'Order not found for this event' })
  }
  return order
}

export default defineEventHandler(async (event) => {
  // Request rules live in the pure `readHandoverRequest` so they are unit
  // tested; the handler keeps one guard.
  const parsed = readHandoverRequest({
    eventId: getRouterParam(event, 'eventId'),
    body: await readBody(event)
  })
  if (!parsed.ok) {
    throw createError({ status: 400, statusText: parsed.message })
  }
  const { eventId, orderId } = parsed

  const db = useDB()
  const order = await requireOrderInEvent(db, orderId, eventId)

  const { created } = await recordHandover(db, {
    table: salesHandovers,
    eventId,
    orderId,
    teamId: order.teamId,
    owner: order.owner,
    actor: 'pass'
  })

  // `created: false` is a success — the order was already handed over. The pass
  // screen treats both identically; the flag is only for observability.
  return { success: true, orderId, created }
})
