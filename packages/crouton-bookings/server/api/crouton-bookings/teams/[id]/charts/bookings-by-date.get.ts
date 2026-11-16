/**
 * Bookings by Date chart endpoint
 *
 * Returns booking counts grouped by date for the requesting team.
 * Used by the 'bookings:by-date' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: admins only until a chart block can grant its own audience (#3938)
  const { team } = await requireTeamAdmin(event)
  const db = useDB()

  const rows = await db
    .select({
      date: bookingsBookings.date,
      count: count()
    })
    .from(bookingsBookings)
    .where(eq(bookingsBookings.teamId as any, team.id))
    .groupBy(bookingsBookings.date as any)
    .orderBy(bookingsBookings.date)

  return {
    items: rows.map((r: any) => ({
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
      count: Number(r.count)
    }))
  }
})
