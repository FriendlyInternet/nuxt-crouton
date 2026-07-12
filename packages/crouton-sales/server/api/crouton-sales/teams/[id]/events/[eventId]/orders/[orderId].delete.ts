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
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { deleteOrderCascade, findOwnedOrder } from '../../../../../../../utils/delete-order'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)
  const eventId = getRouterParam(event, 'eventId')
  const orderId = getRouterParam(event, 'orderId')

  if (!eventId || !orderId) {
    throw createError({ status: 400, statusText: 'Event ID and Order ID are required' })
  }

  const db = useDB()
  const tables = { salesOrders, salesOrderitems, printJobs }

  // Ownership guard (tested helper): a missing / cross-team / cross-event order
  // is a 404 — never delete blind.
  const order = await findOwnedOrder(orderId, eventId, team.id, { db, tables })
  if (!order) {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  const { deletedItems, deletedJobs } = await deleteOrderCascade(orderId, { db, tables })

  return { success: true, orderId, deletedItems, deletedJobs }
})
