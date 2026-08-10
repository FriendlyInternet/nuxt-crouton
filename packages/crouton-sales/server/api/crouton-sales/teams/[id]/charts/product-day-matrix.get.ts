/**
 * Product × Day matrix endpoint
 *
 * Returns a product-major pivot for the salesProductMatrixBlock table:
 * one entry per product with per-day units AND revenue, plus per-product
 * totals, per-day column totals, and a grand total. Optional ?eventId=
 * narrows to a single event. Team-members only.
 *
 * Products are grouped per category (category displayOrder, units-desc
 * within) and carry their category title + unit price, so the table's CSV
 * download reads per category with the price beside each product (#2126).
 *
 * The table renders both measures and toggles client-side, so this returns
 * units and revenue together rather than one measure.
 */
import { eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope, salesOrderDay } from '../../../../../utils/chart-scope'
import { buildProductDayMatrix } from '../../../../../utils/product-day-matrix'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesCategories } from '~~/layers/sales/collections/categories/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)

  const dateExpr = salesOrderDay(salesOrders)

  const rows = await db
    .select({
      date: dateExpr,
      product: salesProducts.title,
      category: salesCategories.title,
      // Aggregates because only date/product/category are grouping keys; both
      // are constant within a group in practice (per-category displayOrder,
      // per-product price — max() just keeps SQLite happy).
      categoryOrder: sql<number | null>`max(${salesCategories.displayOrder})`,
      price: sql<number | null>`max(${salesProducts.price})`,
      units: sql<number>`sum(cast(${salesOrderitems.quantity} as real))`,
      revenue: sql<number>`sum(${salesOrderitems.totalPrice})`
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .leftJoin(salesCategories, eq(salesProducts.categoryId, salesCategories.id))
    .where(chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }))
    .groupBy(dateExpr, salesProducts.title, salesCategories.title)
    .orderBy(dateExpr)

  return buildProductDayMatrix(rows)
})
