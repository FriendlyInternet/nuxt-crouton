import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { requireScopedEvent } from '../../../../../utils/require-scoped-event'
import { organization } from '@fyit/crouton-auth/server/database/schema/auth'
import { salesEvents } from '~~/layers/sales/collections/events/server/database/schema'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { generateAndInsertPrintQueues } from '../../../../../utils/generate-print-queues'
import { recordOutboxEvents } from '../../../../../utils/sync-outbox'

interface OrderItemInput {
  productId: string
  quantity: number
  price: number
  productName?: string
  remarks?: string
  selectedOptions?: Record<string, unknown>
}

interface CreateOrderBody {
  items: OrderItemInput[]
  total: number
  clientId?: string
  clientName?: string
  overallRemarks?: string
  /** Free-text remark per location, keyed by locationId. Printed per location, not counted in sales. */
  locationRemarks?: Record<string, string>
  isPersonnel?: boolean
}

export default defineEventHandler(async (event) => {
  const { eventId, access, db } = await requireScopedEvent(event)

  const [eventWithTeam] = await db
    .select({ event: salesEvents, team: organization })
    .from(salesEvents)
    .leftJoin(organization, eq(salesEvents.teamId, organization.id))
    .where(eq(salesEvents.id, eventId))
    .limit(1)

  if (!eventWithTeam?.event) {
    throw createError({ status: 404, statusText: 'Event not found' })
  }

  const salesEvent = eventWithTeam.event
  const body = await readBody<CreateOrderBody>(event)

  if (!body.items || body.items.length === 0) {
    throw createError({ status: 400, statusText: 'Order must have at least one item' })
  }

  const [orderCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salesOrders)
    .where(eq(salesOrders.eventId, eventId))

  const eventOrderNumber = String((orderCount?.count || 0) + 1).padStart(4, '0')

  const orderId = nanoid()
  const [order] = await db
    .insert(salesOrders)
    .values({
      id: orderId,
      teamId: salesEvent.teamId,
      owner: access.displayName,
      eventId,
      clientId: body.clientId,
      clientName: body.clientName,
      eventOrderNumber,
      overallRemarks: body.overallRemarks,
      locationRemarks: body.locationRemarks || null,
      isPersonnel: body.isPersonnel || false,
      status: 'pending',
      createdBy: access.id,
      updatedBy: access.id
    })
    .returning()

  const orderItems = await Promise.all(
    body.items.map(async (item) => {
      const [orderItem] = await db
        .insert(salesOrderitems)
        .values({
          teamId: salesEvent.teamId,
          owner: access.displayName,
          orderId,
          productId: item.productId,
          quantity: String(item.quantity),
          unitPrice: item.price,
          totalPrice: item.price * item.quantity,
          remarks: item.remarks,
          selectedOptions: item.selectedOptions || {},
          createdBy: access.id,
          updatedBy: access.id
        })
        .returning()
      return orderItem
    })
  )

  // Capture for the cloud mirror (#176) — one row for the order + one per item,
  // keyed by each row's nanoid. No-op unless CROUTON_SALES_CLOUD_SYNC is on
  // (the venue Pi), best-effort so it never blocks checkout.
  await recordOutboxEvents(db, [
    {
      entityType: 'order',
      entityId: order.id,
      orderId: order.id,
      teamId: salesEvent.teamId,
      eventId,
      payload: order as Record<string, unknown>,
    },
    ...orderItems.map(item => ({
      entityType: 'orderitem' as const,
      entityId: item.id,
      orderId,
      teamId: salesEvent.teamId,
      eventId,
      payload: item as Record<string, unknown>,
    })),
  ])

  let printQueueIds: string[] = []
  const { croutonSales } = useRuntimeConfig(event)
  const printEnabled = (croutonSales as { print?: { enabled?: boolean } } | undefined)?.print?.enabled

  if (printEnabled) {
    printQueueIds = await generateAndInsertPrintQueues({
      db,
      orderId,
      eventId,
      teamId: salesEvent.teamId,
      helperDisplayName: access.displayName,
      helperId: access.id,
      orderNumber: eventOrderNumber,
      clientName: body.clientName || undefined,
      orderNotes: body.overallRemarks || undefined,
      locationRemarks: body.locationRemarks || undefined,
      teamName: eventWithTeam.team?.name || 'POS',
      eventName: salesEvent.title,
      currency: salesEvent.currency || undefined,
      isPersonnel: body.isPersonnel || false
    })
  }

  return { order, items: orderItems, eventOrderNumber, printQueueIds }
})
