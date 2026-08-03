/**
 * Product × Day matrix endpoint
 *
 * Returns a product-major pivot for the salesProductMatrixBlock table:
 * one entry per product with per-day units AND revenue, plus per-product
 * totals, per-day column totals, and a grand total. Optional ?eventId=
 * narrows to a single event. Team-members only.
 *
 * The table renders both measures and toggles client-side, so this returns
 * units and revenue together rather than one measure.
 */
import { and, eq, sql } from 'drizzle-orm'
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

  const dateExpr = sql<string>`date(${salesOrders.createdAt}, 'unixepoch')`

  const rows = await db
    .select({
      date: dateExpr,
      product: salesProducts.title,
      units: sql<number>`sum(cast(${salesOrderitems.quantity} as real))`,
      revenue: sql<number>`sum(${salesOrderitems.totalPrice})`
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(and(eq(salesOrders.teamId, team.id), eventFilter, personnelFilter(personnel)))
    .groupBy(dateExpr, salesProducts.title)
    .orderBy(dateExpr)

  interface Cell { units: number, revenue: number }
  const days = [...new Set((rows as { date: string }[]).map(r => r.date))].sort()
  const productMap = new Map<string, { units: Record<string, number>, revenue: Record<string, number>, totalUnits: number, totalRevenue: number }>()
  const dayTotals: Record<string, Cell> = {}
  let grandUnits = 0
  let grandRevenue = 0

  for (const r of rows as { date: string, product: string, units: number, revenue: number }[]) {
    const u = Number(r.units) || 0
    const rev = Number(r.revenue) || 0

    if (!productMap.has(r.product)) {
      productMap.set(r.product, { units: {}, revenue: {}, totalUnits: 0, totalRevenue: 0 })
    }
    const p = productMap.get(r.product)!
    p.units[r.date] = u
    p.revenue[r.date] = rev
    p.totalUnits += u
    p.totalRevenue += rev

    if (!dayTotals[r.date]) dayTotals[r.date] = { units: 0, revenue: 0 }
    dayTotals[r.date]!.units += u
    dayTotals[r.date]!.revenue += rev

    grandUnits += u
    grandRevenue += rev
  }

  const products = [...productMap.entries()]
    .map(([product, v]) => ({ product, ...v }))
    .sort((a, b) => b.totalUnits - a.totalUnits)

  return {
    days,
    products,
    dayTotals,
    grandTotal: { units: grandUnits, revenue: grandRevenue }
  }
})
