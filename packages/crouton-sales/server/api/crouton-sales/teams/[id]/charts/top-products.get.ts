/**
 * Top Products chart endpoint
 *
 * Ranks products by total quantity sold (top 10) for the requesting team.
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `top-products` chart kind.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { personnelFilter } from '../../../../../utils/personnel-filter'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)
  const eventFilter = eventId ? eq(salesOrders.eventId, String(eventId)) : undefined

  // quantity is stored as TEXT → cast to a number before summing.
  const quantityExpr = sql<number>`sum(cast(${salesOrderitems.quantity} as real))`

  const rows = await db
    .select({
      product: salesProducts.title,
      quantity: quantityExpr
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(and(eq(salesOrders.teamId, team.id), eventFilter, personnelFilter(personnel)))
    .groupBy(salesProducts.title)
    .orderBy(desc(quantityExpr))
    .limit(10)

  return {
    items: rows.map((r: { product: string, quantity: number }) => ({
      product: r.product,
      quantity: Number(r.quantity) || 0
    }))
  }
})
