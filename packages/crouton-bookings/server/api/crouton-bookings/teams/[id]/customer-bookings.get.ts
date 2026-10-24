/**
 * Customer-facing endpoint - returns only bookings created by the current user
 *
 * Supports date range queries: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Response includes:
 * - Booking details with location data
 * - Email stats and actions (when email module is enabled)
 */
import { eq, and, asc, gte, lte } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { user as userTable } from '@fyit/crouton-auth/server/database/schema/auth'
import { bookingsBookings } from '../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../collections/locations/server/database/schema'
import { isBookingEmailEnabled } from '../../../../utils/booking-emails'
import { getBatchBookingEmailStats, getBatchBookingEmailDetails } from '../../../../utils/email-service'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  // Check if email is enabled
  const emailEnabled = isBookingEmailEnabled()

  // Parse optional date range query params
  const query = getQuery(event)
  const startDate = query.startDate ? new Date(String(query.startDate)) : null
  const endDate = query.endDate ? new Date(String(query.endDate)) : null

  // Build where conditions
  const conditions = [
    eq(bookingsBookings.teamId as any, team.id),
    eq(bookingsBookings.createdBy as any, user.id),
  ]

  // Add date range conditions if provided
  if (startDate && !isNaN(startDate.getTime())) {
    conditions.push(gte(bookingsBookings.date as any, startDate))
  }
  if (endDate && !isNaN(endDate.getTime())) {
    conditions.push(lte(bookingsBookings.date as any, endDate))
  }

  // Get bookings created by this user
  const bookings = await db
    .select({
      id: bookingsBookings.id,
      teamId: bookingsBookings.teamId,
      owner: bookingsBookings.owner,
      location: bookingsBookings.location,
      date: bookingsBookings.date,
      slot: bookingsBookings.slot,
      quantity: bookingsBookings.quantity,
      group: bookingsBookings.group,
      status: bookingsBookings.status,
      createdAt: bookingsBookings.createdAt,
      updatedAt: bookingsBookings.updatedAt,
      createdBy: bookingsBookings.createdBy,
      updatedBy: bookingsBookings.updatedBy,
      locationData: {
        id: bookingsLocations.id,
        title: bookingsLocations.title,
        color: bookingsLocations.color,
        street: bookingsLocations.street,
        zip: bookingsLocations.zip,
        city: bookingsLocations.city,
        location: bookingsLocations.location,
        slots: bookingsLocations.slots,
        inventoryMode: bookingsLocations.inventoryMode,
        quantity: bookingsLocations.quantity,
        translations: bookingsLocations.translations,
      },
      createdByUser: {
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        avatarUrl: userTable.image,
      },
    })
    .from(bookingsBookings)
    .leftJoin(bookingsLocations as any, eq(bookingsBookings.location as any, (bookingsLocations as any).id))
    .leftJoin(userTable as any, eq(bookingsBookings.createdBy as any, (userTable as any).id))
    .where(and(...conditions))
    .orderBy(asc(bookingsBookings.date as any))

  // Build available email actions based on booking status
  function getEmailActionsForBooking(booking: { status: string }) {
    if (!emailEnabled) return []

    const actions = []

    // Can always resend booking confirmation
    actions.push({
      triggerType: 'booking_created',
      label: 'Resend Confirmation',
      icon: 'i-lucide-mail-check'
    })

    // Cancelled bookings can resend cancellation notice
    if (booking.status === 'cancelled') {
      actions.push({
        triggerType: 'booking_cancelled',
        label: 'Resend Cancellation',
        icon: 'i-lucide-mail-x'
      })
    }

    return actions
  }

  // Add email data when email is enabled (batch queries: 2 queries instead of 3N)
  let enrichedBookings = bookings
  if (emailEnabled && bookings.length > 0) {
    const bookingIds = bookings.map((b: any) => b.id)
    const [statsMap, detailsMap] = await Promise.all([
      getBatchBookingEmailStats(bookingIds, team.id),
      getBatchBookingEmailDetails(
        bookings.map((b: any) => ({ id: b.id, date: b.date, createdAt: b.createdAt })),
        team.id
      )
    ])
    enrichedBookings = bookings.map((booking: any) => ({
      ...booking,
      emailStats: statsMap.get(booking.id) ?? { total: 0, sent: 0, pending: 0, failed: 0 },
      emailDetails: detailsMap.get(booking.id) ?? [],
      emailActions: getEmailActionsForBooking(booking)
    }))
  }

  // If date params were provided, return with metadata
  // Otherwise return just the array for backwards compatibility
  if (startDate || endDate) {
    return {
      items: enrichedBookings,
      dateRange: {
        startDate: startDate?.toISOString().split('T')[0] || null,
        endDate: endDate?.toISOString().split('T')[0] || null,
      },
    }
  }

  // Backwards compatible: return array directly
  return enrichedBookings
})
