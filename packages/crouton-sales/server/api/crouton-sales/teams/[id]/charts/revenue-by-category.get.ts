/**
 * Revenue by Category chart endpoint
 *
 * Sums order-item revenue grouped by product category for the requesting team.
 * Products with no category roll up under "Uncategorized".
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `revenue-by-category` chart kind.
 */
import { desc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope } from '../../../../../utils/chart-scope'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesCategories } from '~~/layers/sales/collections/categories/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)

  const categoryExpr = sql<string>`coalesce(${salesCategories.title}, 'Uncategorized')`
  const revenueExpr = sql<number>`sum(${salesOrderitems.totalPrice})`

  const rows = await db
    .select({
      category: categoryExpr,
      revenue: revenueExpr
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .leftJoin(salesCategories, eq(salesProducts.categoryId, salesCategories.id))
    .where(chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }))
    .groupBy(categoryExpr)
    .orderBy(desc(revenueExpr))

  return {
    items: rows.map((r: { category: string, revenue: number }) => ({
      category: r.category,
      revenue: Number(r.revenue) || 0
    }))
  }
})
