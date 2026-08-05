/**
 * Revenue by Product chart endpoint
 *
 * Sums order-item revenue grouped by product title for the requesting team.
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `revenue-by-product` chart kind.
 */
import { desc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope } from '../../../../../utils/chart-scope'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)

  const revenueExpr = sql<number>`sum(${salesOrderitems.totalPrice})`

  const rows = await db
    .select({
      product: salesProducts.title,
      revenue: revenueExpr
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }))
    .groupBy(salesProducts.title)
    .orderBy(desc(revenueExpr))

  return {
    items: rows.map((r: { product: string, revenue: number }) => ({
      product: r.product,
      revenue: Number(r.revenue) || 0
    }))
  }
})
