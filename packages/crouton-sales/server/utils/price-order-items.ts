/**
 * Server-side pricing and client lookup for a new order (#4481).
 *
 * The orders POST used to store whatever the till sent: any client id (even
 * another team's), any product id (even another event's) and any price. These
 * two helpers replace the body's values with the database's:
 *
 * - `priceOrderItems` prices every item from THIS event's products (one query,
 *   indexed by id). An unknown product or a quantity that is not a positive
 *   whole number is a 400. The body's `price` is never read.
 * - `orderClient` looks the client up by id AND team (400 if missing) and takes
 *   its name from `title`. Without an id, a trimmed walk-in name from the body
 *   is kept. `isActive` is deliberately not checked: a till with a stale picker
 *   may still send a just-deactivated client, and refusing would lose a sale.
 *
 * The tables are injected: they live in the consuming app's generated layer,
 * which a package unit test cannot resolve (same as `cancel-order.ts`).
 */
import { and, eq } from 'drizzle-orm'
import { itemUnitPrice } from '../../shared/utils/item-price'

export interface OrderItemToPrice {
  productId: string
  quantity: number
  selectedOptions?: unknown
}

export interface PricedOrderItem {
  productId: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export async function priceOrderItems(
  db: any,
  input: { products: any, eventId: string, teamId: string, items: OrderItemToPrice[] }
): Promise<PricedOrderItem[]> {
  const { products, eventId, teamId, items } = input
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.eventId, eventId), eq(products.teamId, teamId)))
  const byId = new Map<string, any>(rows.map((row: any) => [row.id, row]))

  return items.map(item => priceOne(byId, item))
}

function badRequest(statusText: string): never {
  throw createError({ status: 400, statusText })
}

function isWholePositive(quantity: unknown): quantity is number {
  return Number.isInteger(quantity) && (quantity as number) > 0
}

function priceOne(byId: Map<string, any>, item: OrderItemToPrice): PricedOrderItem {
  const product = byId.get(String(item?.productId)) ?? badRequest('Unknown product')
  if (!isWholePositive(item.quantity)) badRequest('Invalid quantity')
  const unitPrice = itemUnitPrice(product, item.selectedOptions)
  return {
    productId: product.id,
    quantity: item.quantity,
    unitPrice,
    totalPrice: unitPrice * item.quantity
  }
}

/** A trimmed walk-in name, or null when there is none. */
function walkInName(clientName: unknown): string | null {
  return (typeof clientName === 'string' && clientName.trim()) || null
}

export async function orderClient(
  db: any,
  input: { clients: any, teamId: string, clientId?: unknown, clientName?: unknown }
): Promise<{ clientId: string | null, clientName: string | null }> {
  const { clients, teamId, clientId, clientName } = input
  if (typeof clientId !== 'string' || clientId === '') {
    return { clientId: null, clientName: walkInName(clientName) }
  }
  const [row] = await db
    .select({ id: clients.id, title: clients.title })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.teamId, teamId)))
    .limit(1)
  if (!row) badRequest('Unknown client')
  return { clientId: row.id, clientName: row.title }
}
