/**
 * Hard-delete one order from the workspace (#1518).
 *
 * Team-ADMIN only (a member can't delete). Verifies the order belongs to this
 * team AND event before touching anything, then cascades: line items
 * (`sales_orderitems`) → print jobs (the generic crouton-printing `print_jobs`
 * queue, scoped `source='sales'`/`refType='order'`/`refId=orderId`) → the order
 * row. The `cancelled` status stays as the soft alternative for real events;
 * this is the hard remove for mistaken / test orders.
 */
import { eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { deleteOrderCascade } from '../../../../../../../utils/delete-order'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)
  const eventId = getRouterParam(event, 'eventId')
  const orderId = getRouterParam(event, 'orderId')

  if (!eventId || !orderId) {
    throw createError({ status: 400, statusText: 'Event ID and Order ID are required' })
  }

  const db = useDB()

  // Ownership guard: the order must belong to this team and this event. A
  // missing / cross-team / cross-event order is a 404 — never delete blind.
  const [order] = await db
    .select({ id: salesOrders.id, eventId: salesOrders.eventId, teamId: salesOrders.teamId })
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId))
    .limit(1)

  if (!order || order.eventId !== eventId || order.teamId !== team.id) {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  const { deletedItems, deletedJobs } = await deleteOrderCascade(orderId, {
    db,
    tables: { salesOrders, salesOrderitems, printJobs }
  })

  return { success: true, orderId, deletedItems, deletedJobs }
})
