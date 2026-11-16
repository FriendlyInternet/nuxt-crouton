/**
 * Member-safe calendar feed (#3135) - every team booking, but only the fields the
 * availability calendar needs (no owner, names or emails). The full list is
 * admin-bookings, which is admin-only.
 */
import { eq } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  return await useDB()
    .select({
      id: bookingsBookings.id,
      location: bookingsBookings.location,
      date: bookingsBookings.date,
      slot: bookingsBookings.slot,
      quantity: bookingsBookings.quantity,
      status: bookingsBookings.status,
    })
    .from(bookingsBookings)
    .where(eq(bookingsBookings.teamId as any, team.id))
})
