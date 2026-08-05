/**
 * Units per Product per Day chart endpoint
 *
 * Returns units sold per product, bucketed by calendar day, pivoted so each
 * product is its own column (series) — lets you compare e.g. beers vs fries
 * sold on each day. Optional ?eventId= narrows to a single event.
 *
 * Shape (consumed by CroutonChartsWidget with xField=date, yFields auto-detected):
 *   [{ date: '2026-06-01', Beer: 124, Fries: 88 }, ...]
 *
 * Every row carries every product key (zero-filled) so the widget's
 * first-row series auto-detection picks up all products, not only those
 * that happened to sell on the first day.
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

  // createdAt is an integer Unix-seconds timestamp; quantity is TEXT → cast.
  const dateExpr = sql<string>`date(${salesOrders.createdAt}, 'unixepoch')`

  const rows = await db
    .select({
      date: dateExpr,
      product: salesProducts.title,
      units: sql<number>`sum(cast(${salesOrderitems.quantity} as real))`
    })
    .from(salesOrderitems)
    .innerJoin(salesOrders, eq(salesOrderitems.orderId, salesOrders.id))
    .innerJoin(salesProducts, eq(salesOrderitems.productId, salesProducts.id))
    .where(and(eq(salesOrders.teamId, team.id), eventFilter, personnelFilter(personnel)))
    .groupBy(dateExpr, salesProducts.title)
    .orderBy(dateExpr)

  // Pivot rows → one entry per day with a column per product (zero-filled).
  const products = new Set<string>()
  const byDate = new Map<string, Record<string, number>>()

  for (const r of rows as { date: string, product: string, units: number }[]) {
    products.add(r.product)
    if (!byDate.has(r.date)) byDate.set(r.date, {})
    byDate.get(r.date)![r.product] = Number(r.units) || 0
  }

  const productList = [...products].sort()
  const items = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => {
      const row: Record<string, unknown> = { date }
      for (const p of productList) row[p] = vals[p] ?? 0
      return row
    })

  return { items }
})
