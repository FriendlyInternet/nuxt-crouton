/**
 * Sales by Location chart endpoint
 *
 * Sums order-item revenue grouped by each product's prep location for the
 * requesting team. Products with no location roll up under "No location".
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `sales-by-location` chart kind.
 */
import { desc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope } from '../../../../../utils/chart-scope'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesLocations } from '~~/layers/sales/collections/locations/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)

  const locationExpr = sql<string>`coalesce(${salesLocations.title}, 'No location')`
  const revenueExpr = sql<number>`sum(${salesOrderitems.totalPrice})`

  const rows = await db
    .select({
      location: locationExpr,
      revenue: revenueExpr
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .leftJoin(salesLocations, eq(salesProducts.locationId, salesLocations.id))
    .where(chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }))
    .groupBy(locationExpr)
    .orderBy(desc(revenueExpr))

  return {
    items: rows.map((r: { location: string, revenue: number }) => ({
      location: r.location,
      revenue: Number(r.revenue) || 0
    }))
  }
})
