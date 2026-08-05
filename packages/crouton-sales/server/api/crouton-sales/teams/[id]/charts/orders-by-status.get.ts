/**
 * Orders by Status chart endpoint
 *
 * Counts orders grouped by status for the requesting team.
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `orders-by-status` chart kind.
 *
 * ## The one chart that deliberately COUNTS cancelled orders (#1925)
 *
 * Every other money/unit chart applies `excludesCancelledOrders`. This one must
 * not: it groups by status, so filtering cancelled orders out would delete the
 * `cancelled` bucket the chart exists to show — the reading would silently
 * become "orders by status, except the interesting one".
 *
 * This exemption is enforced from both sides in `test/order-status.test.ts`:
 * every other endpoint in this directory is asserted to use the shared filter,
 * and this file is asserted NOT to. Removing the exemption should therefore be
 * a deliberate act, not a tidy-up.
 */
import { count, desc } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { chartOrderScope } from '../../../../../utils/chart-scope'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)

  const rows = await db
    .select({
      status: salesOrders.status,
      count: count()
    })
    .from(salesOrders)
    .where(chartOrderScope(salesOrders, { teamId: team.id, eventId, personnel }, { includeCancelled: true }))
    .groupBy(salesOrders.status)
    .orderBy(desc(count()))

  return {
    items: rows.map((r: { status: string, count: number }) => ({
      status: r.status,
      count: Number(r.count) || 0
    }))
  }
})
