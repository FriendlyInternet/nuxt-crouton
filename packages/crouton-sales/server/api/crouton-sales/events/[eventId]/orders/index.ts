import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { requireScopedEvent } from '../../../../../utils/require-scoped-event'
import { organization } from '@fyit/crouton-auth/server/database/schema/auth'
import { salesOrders } from '../../../../../../collections/orders/server/database/schema'
import { salesOrderitems } from '../../../../../../collections/orderitems/server/database/schema'
import { salesProducts } from '../../../../../../collections/products/server/database/schema'
import { salesClients } from '../../../../../../collections/clients/server/database/schema'
import { priceOrderItems, orderClient } from '../../../../../utils/price-order-items'
import { generateAndInsertPrintQueues } from '../../../../../utils/generate-print-queues'
import { recordOutboxEvents } from '../../../../../utils/sync-outbox'

interface OrderItemInput {
  productId: string
  quantity: number
  productName?: string
  remarks?: string
  selectedOptions?: Record<string, unknown>
}

interface CreateOrderBody {
  items: OrderItemInput[]
  clientId?: string
  clientName?: string
  overallRemarks?: string
  /** Free-text remark per location, keyed by locationId. Printed per location, not counted in sales. */
  locationRemarks?: Record<string, string>
  isPersonnel?: boolean
}

// POST only. Any other method answers 405 (not the 404 a `.post.ts` route gives),
// so the deployed smoke can tell "route is mounted" from "route missing".
export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  // The helper loads the event scoped to the token's team (404 otherwise).
  const { eventId, access, db, salesEvent } = await requireScopedEvent(event)
  const [team] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, salesEvent.teamId))
    .limit(1)

  const body = await readBody<CreateOrderBody>(event)

  if (!body.items || body.items.length === 0) {
    throw createError({ status: 400, statusText: 'Order must have at least one item' })
  }

  // The server decides who the client is and what everything costs (#4481) —
  // the body's client name, product ids and prices are never stored as sent.
  // Both run before any insert, so a bad request writes nothing.
  const client = await orderClient(db, {
    clients: salesClients,
    teamId: salesEvent.teamId,
    clientId: body.clientId,
    clientName: body.clientName
  })
  const priced = await priceOrderItems(db, {
    products: salesProducts,
    eventId,
    teamId: salesEvent.teamId,
    items: body.items
  })

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
      clientId: client.clientId,
      clientName: client.clientName,
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
    body.items.map(async (item, i) => {
      const [orderItem] = await db
        .insert(salesOrderitems)
        .values({
          teamId: salesEvent.teamId,
          owner: access.displayName,
          orderId,
          productId: priced[i]!.productId,
          quantity: String(priced[i]!.quantity),
          unitPrice: priced[i]!.unitPrice,
          totalPrice: priced[i]!.totalPrice,
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
      clientName: client.clientName || undefined,
      orderNotes: body.overallRemarks || undefined,
      locationRemarks: body.locationRemarks || undefined,
      teamName: team?.name || 'POS',
      eventName: salesEvent.title,
      currency: salesEvent.currency || undefined,
      isPersonnel: body.isPersonnel || false
    })
  }

  return { order, items: orderItems, eventOrderNumber, printQueueIds }
})
