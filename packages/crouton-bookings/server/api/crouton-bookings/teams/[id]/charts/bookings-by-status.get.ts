/**
 * Bookings by Status chart endpoint
 *
 * Returns booking counts grouped by status for the requesting team.
 * Used by the 'bookings:by-status' chart preset.
 */
import { count } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingChartFiltersFromEvent, bookingChartWhere } from '../../../../../utils/chart-filters'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: admins only until a chart block can grant its own audience (#3938)
  const { team } = await requireTeamAdmin(event)
  const where = bookingChartWhere(team.id, bookingChartFiltersFromEvent(event))
  const db = useDB()

  const rows = await db
    .select({
      status: bookingsBookings.status,
      count: count()
    })
    .from(bookingsBookings)
    .where(where)
    .groupBy(bookingsBookings.status as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      status: r.status || 'unknown',
      count: Number(r.count)
    }))
  }
})
