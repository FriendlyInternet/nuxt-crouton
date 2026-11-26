/**
 * Bookings by Status chart endpoint
 *
 * Returns booking counts grouped by status for the requesting team.
 * Used by the 'bookings:by-status' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: only roles that may manage bookings (#4565)
  const { team } = await requireCan(event, 'bookings:manage')
  const db = useDB()

  const rows = await db
    .select({
      status: bookingsBookings.status,
      count: count()
    })
    .from(bookingsBookings)
    .where(eq(bookingsBookings.teamId as any, team.id))
    .groupBy(bookingsBookings.status as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      status: r.status || 'unknown',
      count: Number(r.count)
    }))
  }
})
