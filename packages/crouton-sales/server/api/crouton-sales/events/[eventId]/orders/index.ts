import type { H3Event } from 'h3'
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

type Scoped = Awaited<ReturnType<typeof requireScopedEvent>>
type Client = Awaited<ReturnType<typeof orderClient>>
type Priced = Awaited<ReturnType<typeof priceOrderItems>>

interface OrderContext extends Scoped {
  body: CreateOrderBody
  client: Client
  orderId: string
  eventOrderNumber: string
}

const orUndefined = <T>(value: T | null | undefined | '' | false): T | undefined => value || undefined

async function readOrderBody(event: H3Event): Promise<CreateOrderBody> {
  const body = await readBody<CreateOrderBody>(event)
  if (!body.items || body.items.length === 0) {
    throw createError({ status: 400, statusText: 'Order must have at least one item' })
  }
  return body
}

async function nextOrderNumber({ db, eventId }: Scoped): Promise<string> {
  const [orderCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(salesOrders)
    .where(eq(salesOrders.eventId, eventId))
  return String((orderCount?.count || 0) + 1).padStart(4, '0')
}

async function insertOrder(ctx: OrderContext) {
  const { db, salesEvent, access, eventId, body, client } = ctx
  const [order] = await db
    .insert(salesOrders)
    .values({
      id: ctx.orderId,
      teamId: salesEvent.teamId,
      owner: access.displayName,
      eventId,
      clientId: client.clientId,
      clientName: client.clientName,
      eventOrderNumber: ctx.eventOrderNumber,
      overallRemarks: body.overallRemarks,
      locationRemarks: body.locationRemarks || null,
      isPersonnel: body.isPersonnel || false,
      status: 'pending',
      createdBy: access.id,
      updatedBy: access.id
    })
    .returning()
  return order
}

function insertOrderItems(ctx: OrderContext, priced: Priced) {
  const { db, salesEvent, access, body, orderId } = ctx
  return Promise.all(
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
}

// Capture for the cloud mirror (#176) — one row for the order + one per item,
// keyed by each row's nanoid. No-op unless CROUTON_SALES_CLOUD_SYNC is on
// (the venue Pi), best-effort so it never blocks checkout.
function recordOrderOutbox(
  ctx: OrderContext,
  order: { id: string },
  orderItems: Array<{ id: string }>
) {
  const { db, salesEvent, eventId, orderId } = ctx
  return recordOutboxEvents(db, [
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
}

function printEnabled(event: H3Event): boolean {
  const { croutonSales } = useRuntimeConfig(event)
  return Boolean((croutonSales as { print?: { enabled?: boolean } } | undefined)?.print?.enabled)
}

async function teamName({ db, salesEvent }: Scoped): Promise<string> {
  const [team] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, salesEvent.teamId))
    .limit(1)
  return team?.name || 'POS'
}

async function printOrder(ctx: OrderContext): Promise<string[]> {
  const { db, salesEvent, access, eventId, body, client, orderId } = ctx
  return generateAndInsertPrintQueues({
    db,
    orderId,
    eventId,
    teamId: salesEvent.teamId,
    helperDisplayName: access.displayName,
    helperId: access.id,
    orderNumber: ctx.eventOrderNumber,
    clientName: orUndefined(client.clientName),
    orderNotes: orUndefined(body.overallRemarks),
    locationRemarks: orUndefined(body.locationRemarks),
    teamName: await teamName(ctx),
    eventName: salesEvent.title,
    currency: orUndefined(salesEvent.currency),
    isPersonnel: Boolean(body.isPersonnel)
  })
}

async function createOrder(event: H3Event) {
  // The helper loads the event scoped to the token's team (404 otherwise).
  const scoped = await requireScopedEvent(event)
  const { db, eventId, salesEvent } = scoped
  const body = await readOrderBody(event)

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

  const ctx: OrderContext = {
    ...scoped,
    body,
    client,
    orderId: nanoid(),
    eventOrderNumber: await nextOrderNumber(scoped)
  }
  const order = await insertOrder(ctx)
  const orderItems = await insertOrderItems(ctx, priced)
  await recordOrderOutbox(ctx, order, orderItems)

  const printQueueIds = printEnabled(event) ? await printOrder(ctx) : []
  return { order, items: orderItems, eventOrderNumber: ctx.eventOrderNumber, printQueueIds }
}

// POST only. Any other method answers 405 (not the 404 a `.post.ts` route gives),
// so the deployed smoke can tell "route is mounted" from "route missing".
export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  return createOrder(event)
})
