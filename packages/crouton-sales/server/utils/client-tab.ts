/**
 * Aggregate a client's open tab at one event: every non-cancelled order's
 * items merged into receipt lines — same product, same unit price, same
 * selected options become one line with the summed quantity. Shared by the
 * end-receipt print endpoint and the read-only tab preview GET (the
 * expandable rows in the workspace clients panel), so the preview shows
 * exactly what the receipt will print.
 */
import { eq, and, ne, inArray } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { resolvePrintOptionLabels } from './option-labels'

export interface ClientTabLine {
  name: string
  quantity: number
  price: number
  optionLabels: string[]
  total: number
}

export async function aggregateClientTab(db: any, eventId: string, clientId: string) {
  const orders = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(
      eq(salesOrders.eventId, eventId),
      eq(salesOrders.clientId, clientId),
      ne(salesOrders.status, 'cancelled')
    ))

  const orderIds = orders.map((o: { id: string }) => o.id)
  if (orderIds.length === 0) {
    return { orderIds, lines: [] as ClientTabLine[], total: 0 }
  }

  const items = await db
    .select()
    .from(salesOrderitems)
    .where(inArray(salesOrderitems.orderId, orderIds))

  const products = await db.select().from(salesProducts).where(eq(salesProducts.eventId, eventId))
  const productById = new Map(products.map((p: any) => [p.id, p]))

  const aggregated = new Map<string, ClientTabLine>()
  for (const it of items as any[]) {
    const product: any = productById.get(it.productId)

    // Resolve selected option IDs to readable labels (print/receipt path —
    // unknown ids dropped, shared with generate-print-queues).
    const optionLabels = resolvePrintOptionLabels(it.selectedOptions, product?.options)

    const unitPrice = Number(it.unitPrice)
    const key = `${it.productId}|${unitPrice}|${[...optionLabels].sort().join(',')}`
    const quantity = Number(it.quantity)
    const lineTotal = Number(it.totalPrice ?? unitPrice * quantity)

    const existing = aggregated.get(key)
    if (existing) {
      existing.quantity += quantity
      existing.total += lineTotal
    }
    else {
      aggregated.set(key, {
        name: product?.title || 'Item',
        quantity,
        price: unitPrice,
        optionLabels,
        total: lineTotal
      })
    }
  }

  const lines = [...aggregated.values()]
  const total = lines.reduce((sum, line) => sum + line.total, 0)
  return { orderIds, lines, total }
}
