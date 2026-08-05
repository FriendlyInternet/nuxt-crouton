/**
 * Cancel one order — void a mis-punch without destroying it (#1941).
 *
 * Team-ADMIN only, mirroring the hard-delete beside it (#1518): a member or a
 * PIN helper must not be able to void takings. The two live together in the
 * expanded order row and are deliberately both kept — cancel means "didn't
 * happen, still on the books", delete means "gone from history".
 *
 * Unlike delete, this touches NOTHING but the status. The line items and print
 * jobs are the record we are keeping; the ticket has usually already printed, so
 * there is nothing to pull out of the queue either.
 *
 * The scoped write + idempotency live in the unit-tested `cancel-order` util
 * (`test/cancel-order.test.ts`); this handler stays a thin auth → delegate →
 * map-to-HTTP, matching the delete endpoint.
 */
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { actorLabel, cancelOrder } from '../../../../../../../../utils/cancel-order'

export default defineEventHandler(async (event) => {
  const { team, user } = await requireTeamAdmin(event)
  const eventId = getRouterParam(event, 'eventId')
  const orderId = getRouterParam(event, 'orderId')

  if (!eventId || !orderId) {
    throw createError({ status: 400, statusText: 'Event ID and Order ID are required' })
  }

  const { outcome } = await cancelOrder(useDB(), {
    table: salesOrders,
    orderId,
    teamId: team.id,
    eventId,
    actor: actorLabel(user)
  })

  // A cross-team or cross-event id is indistinguishable from a missing one —
  // the scope is enforced in the WHERE, so this cannot leak whether some other
  // team's order exists.
  if (outcome === 'not-found') {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  // `already-cancelled` is a success: the second tap of a double-tap wanted
  // exactly the state the first one produced.
  return { success: true, orderId, outcome }
})
