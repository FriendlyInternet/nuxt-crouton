/**
 * Bookings by Group chart endpoint
 *
 * Returns booking counts grouped by age group / category for the requesting team.
 * Only includes rows where group is set (excludes null/empty).
 * Used by the 'bookings:by-group' chart preset.
 */
import { count, isNotNull, and, ne } from 'drizzle-orm'
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
      group: bookingsBookings.group,
      count: count()
    })
    .from(bookingsBookings)
    .where(and(
      where,
      isNotNull(bookingsBookings.group as any),
      ne(bookingsBookings.group as any, '')
    ))
    .groupBy(bookingsBookings.group as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      group: r.group!,
      count: Number(r.count)
    }))
  }
})
