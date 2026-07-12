/**
 * Orders by Status chart endpoint
 *
 * Counts orders grouped by status for the requesting team.
 * Optional ?eventId= narrows to a single event; omitted ⇒ team-wide.
 * Used by the salesChartBlock's `orders-by-status` chart kind.
 */
import { and, count, desc, eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { personnelFilter } from '../../../../../utils/personnel-filter'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)
  const eventFilter = eventId ? eq(salesOrders.eventId, String(eventId)) : undefined

  const rows = await db
    .select({
      status: salesOrders.status,
      count: count()
    })
    .from(salesOrders)
    .where(and(eq(salesOrders.teamId, team.id), eventFilter, personnelFilter(personnel)))
    .groupBy(salesOrders.status)
    .orderBy(desc(count()))

  return {
    items: rows.map((r: { status: string, count: number }) => ({
      status: r.status,
      count: Number(r.count) || 0
    }))
  }
})
