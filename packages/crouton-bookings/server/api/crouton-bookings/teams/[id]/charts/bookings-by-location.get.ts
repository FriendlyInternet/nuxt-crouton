/**
 * Bookings by Location chart endpoint
 *
 * Returns booking counts grouped by location for the requesting team.
 * Joins with locations table to get the human-readable location title.
 * Used by the 'bookings:by-location' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../collections/locations/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: only roles that may manage bookings (#4565)
  const { team } = await requireCan(event, 'bookings:manage')
  const db = useDB()

  const rows = await db
    .select({
      location: bookingsLocations.title,
      count: count()
    })
    .from(bookingsBookings)
    .leftJoin(bookingsLocations as any, eq(bookingsBookings.location as any, bookingsLocations.id))
    .where(eq(bookingsBookings.teamId as any, team.id))
    .groupBy(bookingsBookings.location as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      location: r.location || 'Unknown',
      count: Number(r.count)
    }))
  }
})
