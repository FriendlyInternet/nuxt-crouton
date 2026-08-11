/**
 * Revenue by Day chart endpoint
 *
 * Sums order-item revenue grouped by calendar day for the requesting team.
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `revenue-by-day` chart kind.
 */
import { and, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope, salesOrderDay } from '../../../../../utils/chart-scope'
import { productCategoryCondition } from '../../../../../utils/product-category-filter'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel, productIds, categoryIds } = getQuery(event)

  const dateExpr = salesOrderDay(salesOrders)

  const rows = await db
    .select({
      date: dateExpr,
      revenue: sql<number>`sum(${salesOrderitems.totalPrice})`
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(and(
      chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }),
      productCategoryCondition(salesProducts.id, salesProducts.categoryId, { productIds, categoryIds })
    ))
    .groupBy(dateExpr)
    .orderBy(dateExpr)

  return {
    items: rows.map((r: { date: string, revenue: number }) => ({
      date: String(r.date),
      revenue: Number(r.revenue) || 0
    }))
  }
})
