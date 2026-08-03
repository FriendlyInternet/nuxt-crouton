/**
 * Bulk-delete EVERY order for one event — the Settings danger-zone "Delete all
 * orders" action (#1519). Cascades orders → order items → this event's
 * sales-domain print jobs, scoped strictly to `eventId` (never team-wide).
 * `salesClients` are left intact — they're reusable and their open-tab totals
 * reset naturally once the orders are gone.
 *
 * Bulk-destructive, so it requires team ADMIN (the UI also guards it behind a
 * typed confirmation). Event ownership is checked by requireTeamEvent.
 *
 * The cascade sequencing lives in the pure `deleteAllEventOrders` orchestrator
 * (server/utils/delete-event-orders.ts, unit-tested); this handler only wires
 * the real drizzle ops.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'
import { requireTeamEvent } from '../../../../../../utils/team-event'
import { deleteAllEventOrders, type DeleteEventOrdersOps } from '../../../../../../utils/delete-event-orders'

export default defineEventHandler(async (event) => {
  // Team admin only — bulk-destructive (#1519). Throws 403 for members.
  await requireTeamAdmin(event)
  // Event must belong to this team; also hands back the db handle + eventId.
  const { db, eventId } = await requireTeamEvent(event)

  const { salesOrders } = await import('~~/layers/sales/collections/orders/server/database/schema')
  const { salesOrderitems } = await import('~~/layers/sales/collections/orderitems/server/database/schema')

  const ops: DeleteEventOrdersOps = {
    async listOrderIds(id) {
      const rows = await db
        .select({ id: salesOrders.id })
        .from(salesOrders)
        .where(eq(salesOrders.eventId, id))
      return rows.map((r: { id: string }) => r.id)
    },
    async deleteOrderItems(orderIds) {
      const deleted = await db
        .delete(salesOrderitems)
        .where(inArray(salesOrderitems.orderId, orderIds))
        .returning({ id: salesOrderitems.id })
      return deleted.length
    },
    async deleteEventPrintJobs(id) {
      // Only this event's sales-domain jobs — a foreign domain's job on the
      // same event (were there one) is out of scope.
      const deleted = await db
        .delete(printJobs)
        .where(and(eq(printJobs.eventId, id), eq(printJobs.source, 'sales')))
        .returning({ id: printJobs.id })
      return deleted.length
    },
    async deleteEventOrders(id) {
      const deleted = await db
        .delete(salesOrders)
        .where(eq(salesOrders.eventId, id))
        .returning({ id: salesOrders.id })
      return deleted.length
    }
  }

  const deleted = await deleteAllEventOrders(eventId, ops)
  return { deleted }
})
