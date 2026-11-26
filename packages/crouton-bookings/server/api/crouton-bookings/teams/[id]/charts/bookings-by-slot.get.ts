/**
 * Bookings by Slot chart endpoint
 *
 * Returns booking counts per time-slot LABEL for the requesting team: slot ids
 * are resolved to their location's label in the page's language, and the same
 * label at two locations is merged into one item. Most booked first.
 * Team-wide statistics: needs `bookings:manage` (#4565).
 * Used by the 'bookings:by-slot' chart preset.
 */
import { count, eq } from 'drizzle-orm'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'
import { bookingsBookings } from '../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../collections/locations/server/database/schema'
import { chartLocale, countBySlotLabel } from '../../../../../utils/booking-charts'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'bookings:manage')
  const db = useDB()

  const rows = await db
    .select({
      slot: bookingsBookings.slot,
      locationSlots: bookingsLocations.slots,
      count: count()
    })
    .from(bookingsBookings)
    .leftJoin(bookingsLocations as any, eq(bookingsBookings.location as any, bookingsLocations.id))
    .where(eq(bookingsBookings.teamId as any, team.id))
    .groupBy(bookingsBookings.location as any, bookingsBookings.slot as any)

  return {
    items: countBySlotLabel(rows as any[], chartLocale(event))
  }
})
