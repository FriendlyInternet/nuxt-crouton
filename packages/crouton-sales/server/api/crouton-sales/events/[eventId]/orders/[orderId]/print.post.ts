import { eq } from 'drizzle-orm'
import { organization } from '@fyit/crouton-auth/server/database/schema/auth'
import { requireScopedEvent } from '../../../../../../utils/require-scoped-event'
import { salesOrders } from '../../../../../../../collections/orders/server/database/schema'
import { generateAndInsertPrintQueues } from '../../../../../../utils/generate-print-queues'

export default defineEventHandler(async (event) => {
  // The helper loads the event scoped to the token's team (404 otherwise).
  const { eventId, access, db, salesEvent } = await requireScopedEvent(event)
  const orderId = getRouterParam(event, 'orderId')

  if (!orderId) {
    throw createError({ status: 400, statusText: 'Order ID is required' })
  }

  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1)

  if (!order || order.eventId !== eventId) {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  const [team] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, salesEvent.teamId))
    .limit(1)

  const queueIds = await generateAndInsertPrintQueues({
    db,
    orderId,
    eventId,
    teamId: salesEvent.teamId,
    helperDisplayName: access.displayName,
    helperId: access.id,
    orderNumber: order.eventOrderNumber || order.id,
    clientName: order.clientName || undefined,
    orderNotes: order.overallRemarks || undefined,
    locationRemarks: (order.locationRemarks as Record<string, string> | null) || undefined,
    teamName: team?.name || 'POS',
    eventName: salesEvent.title,
    currency: salesEvent.currency || undefined,
    isPersonnel: order.isPersonnel || false,
    // Manual reprint is the on-demand path for the customer receipt —
    // checkout itself never queues one.
    withReceipt: true
  })

  return {
    success: true,
    orderId,
    queueIds,
    message: `Generated ${queueIds.length} print queue entries`
  }
})
