/**
 * Sales by Location chart endpoint
 *
 * Sums order-item revenue grouped by each product's prep location for the
 * requesting team. Products with no location roll up under "No location".
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `sales-by-location` chart kind.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { personnelFilter } from '../../../../../utils/personnel-filter'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'
import { salesOrderitems } from '~~/layers/sales/collections/orderitems/server/database/schema'
import { salesProducts } from '~~/layers/sales/collections/products/server/database/schema'
import { salesLocations } from '~~/layers/sales/collections/locations/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)
  const eventFilter = eventId ? eq(salesOrders.eventId, String(eventId)) : undefined

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
    .where(and(eq(salesOrders.teamId, team.id), eventFilter, personnelFilter(personnel)))
    .groupBy(locationExpr)
    .orderBy(desc(revenueExpr))

  return {
    items: rows.map((r: { location: string, revenue: number }) => ({
      location: r.location,
      revenue: Number(r.revenue) || 0
    }))
  }
})
