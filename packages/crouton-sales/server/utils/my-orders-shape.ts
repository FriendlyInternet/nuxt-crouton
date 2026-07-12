/**
 * @crouton-package crouton-sales
 * @description Pure assembly for the helper-authed "my orders" endpoint — takes
 * the three raw query result sets (orders, their items joined to products, and
 * the orders' print jobs) and shapes the slideover payload: items grouped per
 * order with option ids resolved to labels, an order total, and a combined
 * print-status bucket. No DB / Nitro deps, so it's unit-tested directly
 * (`test/my-orders-shape.test.ts`) — which also collapses the CRAP the endpoint
 * would otherwise carry as untested branchy logic.
 */

export interface MyOrderInput {
  id: string
  eventOrderNumber: number | null
  clientName: string | null
  overallRemarks: string | null
  isPersonnel: boolean | null
  status: string
  createdAt: Date | string | number
}

export interface MyOrderItemInput {
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

export interface MyOrderJobInput {
  refId: string | null
  status: string | null
  printMode: string | null
}

export type PrintStatusBucket = 'none' | 'busy' | 'done' | 'failed'

export interface MyOrderItem {
  id: string
  quantity: number | string
  unitPrice: number
  totalPrice: number
  remarks: string | null
  productTitle: string | null
  optionLabels: string[]
}

export interface MyOrder {
  id: string
  eventOrderNumber: number | null
  clientName: string | null
  overallRemarks: string | null
  isPersonnel: boolean | null
  status: string
  createdAt: Date | string | number
  printStatus: PrintStatusBucket
  total: number
  items: MyOrderItem[]
}

/**
 * Combined worst status across an order's jobs (status enum: '0'=pending,
 * '1'=printing, '2'=done, '9'=error). Mirrors OrdersTab's `ledFromStatuses`:
 * failed wins, then busy, then done; no jobs at all ⇒ 'none' (no LED).
 */
export function bucketFromStatuses(statuses: string[]): PrintStatusBucket {
  if (!statuses.length) return 'none'
  if (statuses.includes('9')) return 'failed'
  if (statuses.some(s => s === '0' || s === '1')) return 'busy'
  return 'done'
}

/**
 * Selected options are stored as option ids — resolve each to its label via the
 * joined product's `options` array (raw ids on screen help nobody). Unknown ids
 * fall back to the raw id; one label per selected option.
 */
export function resolveOptionLabels(selectedOptions: unknown, productOptions: unknown): string[] {
  if (!selectedOptions) return []
  const ids = Array.isArray(selectedOptions)
    ? selectedOptions
    : typeof selectedOptions === 'object'
      ? Object.values(selectedOptions as Record<string, unknown>)
      : [selectedOptions]
  const options = (Array.isArray(productOptions) ? productOptions : []) as Array<{ id?: string, label?: string }>
  return ids
    .filter((id): id is string => Boolean(id))
    .map(id => options.find(o => o?.id === id)?.label || String(id))
}

export function shapeMyOrders(
  orders: MyOrderInput[],
  items: MyOrderItemInput[],
  jobs: MyOrderJobInput[]
): MyOrder[] {
  const itemsByOrder = new Map<string, MyOrderItemInput[]>()
  for (const item of items) {
    const list = itemsByOrder.get(item.orderId)
    if (list) list.push(item)
    else itemsByOrder.set(item.orderId, [item])
  }

  // Display (KDS) jobs are bumped on a screen, not printed — exclude from the LED.
  const statusesByOrder = new Map<string, string[]>()
  for (const job of jobs) {
    if (!job.refId || job.printMode === 'display') continue
    const list = statusesByOrder.get(job.refId)
    const s = String(job.status ?? '0')
    if (list) list.push(s)
    else statusesByOrder.set(job.refId, [s])
  }

  return orders.map((order) => {
    const orderItems = (itemsByOrder.get(order.id) || []).map(item => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      remarks: item.remarks,
      productTitle: item.productTitle,
      optionLabels: resolveOptionLabels(item.selectedOptions, item.productOptions)
    }))
    return {
      id: order.id,
      eventOrderNumber: order.eventOrderNumber,
      clientName: order.clientName,
      overallRemarks: order.overallRemarks,
      isPersonnel: order.isPersonnel,
      status: order.status,
      createdAt: order.createdAt,
      printStatus: bucketFromStatuses(statusesByOrder.get(order.id) || []),
      total: orderItems.reduce((sum, i) => sum + (Number(i.totalPrice) || 0), 0),
      items: orderItems
    }
  })
}
