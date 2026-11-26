/**
 * Bookings by Date chart endpoint
 *
 * Returns booking counts grouped per month (in the bookings timezone) for the
 * requesting team, labelled in the page's language (e.g. « janv. 2026 »).
 * Team-wide statistics: needs `bookings:manage` (#4565).
 * Used by the 'bookings:by-date' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { chartLocale, chartTimezone, groupByMonth } from '../../../../../utils/booking-charts'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'bookings:manage')
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
    items: groupByMonth(rows as any[], chartLocale(event), chartTimezone(event))
  }
})
