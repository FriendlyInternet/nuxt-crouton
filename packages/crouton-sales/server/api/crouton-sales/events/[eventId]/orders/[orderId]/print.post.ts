import { eq } from 'drizzle-orm'
import { requireScopedAccessToResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { organization } from '@fyit/crouton-auth/server/database/schema/auth'
import { salesEvents } from '../../../../../../../collections/events/server/database/schema'
import { salesOrders } from '../../../../../../../collections/orders/server/database/schema'
import { generateAndInsertPrintQueues } from '../../../../../../utils/generate-print-queues'

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')
  const orderId = getRouterParam(event, 'orderId')

  if (!eventId || !orderId) {
    throw createError({ status: 400, statusText: 'Event ID and Order ID are required' })
  }

  const access = await requireScopedAccessToResource(event, 'event', eventId)
  const db = useDB()

  const [order] = await db.select().from(salesOrders).where(eq(salesOrders.id, orderId)).limit(1)

  if (!order || order.eventId !== eventId) {
    throw createError({ status: 404, statusText: 'Order not found' })
  }

  const [eventWithTeam] = await db
    .select({ event: salesEvents, team: organization })
    .from(salesEvents)
    .leftJoin(organization, eq(salesEvents.teamId, organization.id))
    .where(eq(salesEvents.id, eventId))
    .limit(1)

  if (!eventWithTeam?.event) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  const queueIds = await generateAndInsertPrintQueues({
    db,
    orderId,
    eventId,
    teamId: eventWithTeam.event.teamId,
    helperDisplayName: access.displayName,
    helperId: access.id,
    orderNumber: order.eventOrderNumber || order.id,
    clientName: order.clientName || undefined,
    orderNotes: order.overallRemarks || undefined,
    locationRemarks: (order.locationRemarks as Record<string, string> | null) || undefined,
    teamName: eventWithTeam.team?.name || 'POS',
    eventName: eventWithTeam.event.title,
    currency: eventWithTeam.event.currency || undefined,
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
