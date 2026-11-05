/**
 * Get user's monthly booking count for a location
 *
 * Query params:
 * - locationId: string (required)
 * - month: YYYY-MM (optional, defaults to current month)
 *
 * Response:
 * { count: number, limit: number | null, remaining: number | null }
 */
import { eq, and, gte, lte } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../collections/locations/server/database/schema'
import { monthBounds, currentMonthBounds } from '@fyit/crouton-core/shared/utils/date'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const query = getQuery(event)
  const locationId = query.locationId as string
  const monthParam = query.month as string | undefined

  if (!locationId) {
    throw createError({
      status: 400,
      statusText: 'locationId is required',
    })
  }

  // Parse month (YYYY-MM) or default to current month
  let monthStart: Date
  let monthEnd: Date

  if (monthParam) {
    const [year, month] = monthParam.split('-').map(Number)
    if (!year || !month || month < 1 || month > 12) {
      throw createError({
        status: 400,
        statusText: 'Invalid month format. Use YYYY-MM.',
      })
    }
    ;({ monthStart, monthEnd } = monthBounds(monthParam))
  }
  else {
    ;({ monthStart, monthEnd } = currentMonthBounds())
  }

  const db = useDB()

  // Get location to check limit
  const [location] = await db
    .select({ maxBookingsPerMonth: bookingsLocations.maxBookingsPerMonth })
    .from(bookingsLocations)
    .where(
      and(
        eq(bookingsLocations.id as any, locationId),
        eq(bookingsLocations.teamId as any, team.id),
      ),
    )

  const limit = location?.maxBookingsPerMonth ?? null

  // Count active bookings by this user for this location in the month
  const bookings = await db
    .select({ id: bookingsBookings.id })
    .from(bookingsBookings)
    .where(
      and(
        eq(bookingsBookings.location as any, locationId),
        eq(bookingsBookings.createdBy as any, user.id),
        eq(bookingsBookings.status as any, 'active'),
        gte(bookingsBookings.date as any, monthStart),
        lte(bookingsBookings.date as any, monthEnd),
      ),
    )

  const count = bookings.length

  return {
    count,
    limit,
    remaining: limit ? Math.max(0, limit - count) : null,
  }
})
