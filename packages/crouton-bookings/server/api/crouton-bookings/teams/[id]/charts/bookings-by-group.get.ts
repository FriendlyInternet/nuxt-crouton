/**
 * Bookings by Group chart endpoint
 *
 * Returns booking counts grouped by age group / category for the requesting team.
 * Only includes rows where group is set (excludes null/empty).
 * Used by the 'bookings:by-group' chart preset.
 */
import { count, eq, isNotNull, and, ne } from 'drizzle-orm'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'

export default defineEventHandler(async (event) => {
  // Team-wide statistics: only roles that may manage bookings (#4565)
  const { team } = await requireCan(event, 'bookings:manage')
  const db = useDB()

  const rows = await db
    .select({
      group: bookingsBookings.group,
      count: count()
    })
    .from(bookingsBookings)
    .where(and(
      eq(bookingsBookings.teamId as any, team.id),
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
