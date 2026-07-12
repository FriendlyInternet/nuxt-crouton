/**
 * Helper-authenticated "my orders" list.
 *
 * Returns the orders the *active user* placed for this event, newest first,
 * each with its line items (product title + options joined) and a combined
 * print-status bucket. This is the volunteer/admin-facing counterpart of the
 * team-authed workspace "Bestellingen" pane (OrdersTab), which a helper token
 * can't reach — it powers the POS order-history slideover.
 *
 * "This person" is keyed on `salesOrders.owner` (the helper displayName stamped
 * at checkout, `orders/index.post.ts`), which is stable across logins — the
 * same key OrdersTab's helper filter uses. `createdBy` is the scoped-token id,
 * which rotates every login, so it can't identify a person across sessions.
 */
import { eq, and, inArray, desc } from 'drizzle-orm'
import { requireScopedAccessToResource } from '@fyit/crouton-auth/server/utils/scoped-access'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { printJobs } from '@fyit/crouton-printing/server/database/schema'

// Newest working set — a single person's orders over an event are bounded, but
// a multi-day event could accumulate many; the slideover is a recent history,
// not an archive.
const MAX_ORDERS = 100

interface OrderRow {
  id: string
  eventOrderNumber: number | null
  clientName: string | null
  overallRemarks: string | null
  isPersonnel: boolean | null
  status: string
  createdAt: Date | string | number
}

interface ItemRow {
  id: string
  orderId: string
  quantity: number | string
  unitPrice: number
  totalPrice: number
  remarks: string | null
  selectedOptions: unknown
  productTitle: string | null
  productOptions: unknown
}

interface JobRow {
  refId: string | null
  status: string | null
  printMode: string | null
}

// Combined worst status across an order's jobs (status enum: '0'=pending,
// '1'=printing, '2'=done, '9'=error). Mirrors OrdersTab's `ledFromStatuses`:
// failed wins, then busy, then done; no jobs at all ⇒ 'none' (no LED).
function bucketFromStatuses(statuses: string[]): 'none' | 'busy' | 'done' | 'failed' {
  if (!statuses.length) return 'none'
  if (statuses.includes('9')) return 'failed'
  if (statuses.some(s => s === '0' || s === '1')) return 'busy'
  return 'done'
}

export default defineEventHandler(async (event) => {
  const eventId = getRouterParam(event, 'eventId')

  if (!eventId) {
    throw createError({ status: 400, statusText: 'Event ID is required' })
  }

  const access = await requireScopedAccessToResource(event, 'event', eventId)
  const db = useDB()

  const orders = await db
    .select({
      id: salesOrders.id,
      eventOrderNumber: salesOrders.eventOrderNumber,
      clientName: salesOrders.clientName,
      overallRemarks: salesOrders.overallRemarks,
      isPersonnel: salesOrders.isPersonnel,
      status: salesOrders.status,
      createdAt: salesOrders.createdAt
    })
    .from(salesOrders)
    .where(and(
      eq(salesOrders.eventId, eventId),
      eq(salesOrders.owner, access.displayName)
    ))
    .orderBy(desc(salesOrders.createdAt))
    .limit(MAX_ORDERS) as OrderRow[]

  if (!orders.length) return []

  const orderIds = orders.map(o => o.id)

  // Items joined to their product (title + options), so the slideover can label
  // lines and resolve option ids without a second round-trip.
  const itemRows = await db
    .select({
      id: salesOrderitems.id,
      orderId: salesOrderitems.orderId,
      quantity: salesOrderitems.quantity,
      unitPrice: salesOrderitems.unitPrice,
      totalPrice: salesOrderitems.totalPrice,
      remarks: salesOrderitems.remarks,
      selectedOptions: salesOrderitems.selectedOptions,
      productTitle: salesProducts.title,
      productOptions: salesProducts.options
    })
    .from(salesOrderitems)
    .leftJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(inArray(salesOrderitems.orderId, orderIds)) as ItemRow[]

  // Print jobs for these orders (source='sales', refType='order'). Display (KDS)
  // jobs are bumped on a screen, not printed — exclude them from the LED.
  const jobRows = await db
    .select({
      refId: printJobs.refId,
      status: printJobs.status,
      printMode: printJobs.printMode
    })
    .from(printJobs)
    .where(and(
      eq(printJobs.source, 'sales'),
      eq(printJobs.refType, 'order'),
      inArray(printJobs.refId, orderIds)
    )) as JobRow[]

  const itemsByOrder = new Map<string, ItemRow[]>()
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId)
    if (list) list.push(item)
    else itemsByOrder.set(item.orderId, [item])
  }

  const jobStatusByOrder = new Map<string, string[]>()
  for (const job of jobRows) {
    if (!job.refId || job.printMode === 'display') continue
    const list = jobStatusByOrder.get(job.refId)
    const s = String(job.status ?? '0')
    if (list) list.push(s)
    else jobStatusByOrder.set(job.refId, [s])
  }

  return orders.map(order => ({
    id: order.id,
    eventOrderNumber: order.eventOrderNumber,
    clientName: order.clientName,
    overallRemarks: order.overallRemarks,
    isPersonnel: order.isPersonnel,
    status: order.status,
    createdAt: order.createdAt,
    printStatus: bucketFromStatuses(jobStatusByOrder.get(order.id) || []),
    items: (itemsByOrder.get(order.id) || []).map(item => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      remarks: item.remarks,
      selectedOptions: item.selectedOptions,
      product: { title: item.productTitle, options: item.productOptions }
    }))
  }))
})
