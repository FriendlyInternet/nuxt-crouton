/**
 * KDS "bump" — clear one order's items at one location off a screen (#61,
 * decoupled KDS).
 *
 * Body `{ orderId, locationId }` identifies the ticket the read endpoint emits.
 * Bumping records a `salesKdsbumps` row for that `(order, location)`; the read
 * then hides it. It's per-location, so bumping the kitchen ticket leaves the
 * same order's bar ticket up until the bar bumps it too.
 *
 * Bumping does NOT touch the order's status or `salesPrintqueues` — a screen is
 * an independent consumer; order lifecycle and printing are separate concerns.
 * Idempotent: a second bump of the same ticket is a no-op.
 *
 * Flat one-param route (`:eventId` + body) on purpose: this app's router does
 * not match a second path param under `/events/:eventId/.../:param`, so the
 * ticket id rides the body rather than the path.
 *
 * Auth: none, matching the read endpoint (unattended screen on the trusted
 * venue LAN; a helper-scoped token is a follow-up).
 */
import { and, eq } from 'drizzle-orm'
import { salesOrders } from '../../../../../collections/orders/server/database/schema'
import { salesKdsbumps } from '../../../../../collections/kdsbumps/server/database/schema'

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')
  if (!eventId) {
    throw createError({ status: 400, statusText: 'eventId is required' })
  }

  const body = await readBody(event)
  const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
  const locationId = typeof body?.locationId === 'string' ? body.locationId : ''
  if (!orderId || !locationId) {
    throw createError({ status: 400, statusText: 'orderId and locationId are required' })
  }

  const db = useDB()

  // The order anchors the bump's tenant + confirms it belongs to this event.
  const [order] = await db
    .select({ teamId: salesOrders.teamId, owner: salesOrders.owner })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, orderId), eq(salesOrders.eventId, eventId)))
    .limit(1)
  if (!order) {
    throw createError({ status: 404, statusText: 'Order not found for this event' })
  }

  // Idempotent — a screen may double-tap, or two screens share a location.
  const [existing] = await db
    .select({ id: salesKdsbumps.id })
    .from(salesKdsbumps)
    .where(and(
      eq(salesKdsbumps.orderId, orderId),
      eq(salesKdsbumps.locationId, locationId)
    ))
    .limit(1)

  if (!existing) {
    await db.insert(salesKdsbumps).values({
      teamId: order.teamId,
      owner: order.owner,
      eventId,
      orderId,
      locationId,
      createdBy: 'kds',
      updatedBy: 'kds'
    })
  }

  return { success: true, orderId, locationId }
})
