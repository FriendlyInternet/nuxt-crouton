/**
 * Bookings by Location chart endpoint
 *
 * Returns booking counts grouped by location for the requesting team.
 * Joins with locations table to get the human-readable location title.
 * Used by the 'bookings:by-location' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingChartFiltersFromEvent, bookingChartWhere } from '../../../../../utils/chart-filters'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../collections/locations/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: admins only until a chart block can grant its own audience (#3938)
  const { team } = await requireTeamAdmin(event)
  const where = bookingChartWhere(team.id, bookingChartFiltersFromEvent(event))
  const db = useDB()

  const rows = await db
    .select({
      location: bookingsLocations.title,
      count: count()
    })
    .from(bookingsBookings)
    .leftJoin(bookingsLocations as any, eq(bookingsBookings.location as any, bookingsLocations.id))
    .where(where)
    .groupBy(bookingsBookings.location as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      location: r.location || 'Unknown',
      count: Number(r.count)
    }))
  }
})
