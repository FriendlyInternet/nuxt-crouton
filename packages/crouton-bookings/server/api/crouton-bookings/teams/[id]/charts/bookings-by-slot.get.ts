/**
 * Bookings by Slot chart endpoint
 *
 * Returns booking counts grouped by time slot for the requesting team.
 * Used by the 'bookings:by-slot' chart preset.
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
      slot: bookingsBookings.slot,
      count: count()
    })
    .from(bookingsBookings)
    .where(eq(bookingsBookings.teamId as any, team.id))
    .groupBy(bookingsBookings.slot as any)
    .orderBy(count())

  return {
    items: rows.map((r: any) => ({
      slot: r.slot || 'Unknown',
      count: Number(r.count)
    }))
  }
})
