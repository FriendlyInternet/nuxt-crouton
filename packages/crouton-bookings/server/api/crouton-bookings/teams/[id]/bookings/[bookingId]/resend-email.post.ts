/**
 * Resend email for a specific booking
 * POST /api/crouton-bookings/teams/[id]/bookings/[bookingId]/resend-email
 *
 * Requires:
 * - Email module enabled: runtimeConfig.croutonBookings.email.enabled = true
 * - @fyit/crouton-email installed and configured
 * - Email template and log schemas generated
 *
 * Body: { triggerType: 'booking_confirmed' | 'reminder_before' | 'booking_cancelled' | 'follow_up_after' }
 */
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import {
  isBookingEmailEnabled,
  resolveTranslatedField,
  resolveSlotLabels,
  type BookingEmailTriggerType
} from '../../../../../../utils/booking-emails'
import {
  sendBookingEmails,
  type BookingEmailContext
} from '../../../../../../utils/email-service'

const bodySchema = z.object({
  triggerType: z.enum(['booking_created', 'reminder_before', 'booking_cancelled', 'follow_up_after']),
  locale: z.string().optional().default('en')
})

export default defineEventHandler(async (event) => {
  // Check if email module is enabled
  if (!isBookingEmailEnabled()) {
    throw createError({
      status: 400,
      statusText: 'Email module is not enabled. Set runtimeConfig.croutonBookings.email.enabled = true'
    })
  }

  const { team, user } = await resolveTeamAndCheckMembership(event)
  const { bookingId } = getRouterParams(event)

  // Validate request body
  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid request body. Expected { triggerType: "booking_created" | "reminder_before" | "booking_cancelled" | "follow_up_after" }'
    })
  }

  const { triggerType, locale } = parsed.data
  const db = useDB()

  // Fetch booking with location data
  let booking: any
  try {
    const { bookingsBookings } = await import(
      '~~/layers/bookings/collections/bookings/server/database/schema'
    )
    const { bookingsLocations } = await import(
      '~~/layers/bookings/collections/locations/server/database/schema'
    )

    const results = await db
      .select({
        id: bookingsBookings.id,
        teamId: bookingsBookings.teamId,
        owner: bookingsBookings.owner,
        location: bookingsBookings.location,
        date: bookingsBookings.date,
        slot: bookingsBookings.slot,
        status: bookingsBookings.status,
        locationData: {
          id: bookingsLocations.id,
          title: bookingsLocations.title,
          street: bookingsLocations.street,
          city: bookingsLocations.city,
          content: bookingsLocations.content,
          translations: bookingsLocations.translations,
          slots: bookingsLocations.slots
        }
      })
      .from(bookingsBookings)
      .leftJoin(bookingsLocations as any, eq(bookingsBookings.location as any, bookingsLocations.id))
      .where(
        and(
          eq(bookingsBookings.id as any, bookingId),
          eq(bookingsBookings.teamId as any, team.id)
        )
      )
      .limit(1)

    booking = results[0]
  }
  catch (error) {
    console.error('[resend-email] Failed to fetch booking:', error)
    throw createError({
      status: 500,
      statusText: 'Failed to fetch booking data'
    })
  }

  if (!booking) {
    throw createError({
      status: 404,
      statusText: 'Booking not found'
    })
  }

  // Build booking context for email — resolve translations
  const teamMetadata = (team.metadata || {}) as Record<string, string>
  const ld = booking.locationData as any
  const tr = ld?.translations as Record<string, Record<string, string>> | null
  const locationTitle = resolveTranslatedField(ld?.title, tr, 'title', locale) || 'Location'
  const locationStreet = resolveTranslatedField(ld?.street, tr, 'street', locale)
  const locationCity = resolveTranslatedField(ld?.city, tr, 'city', locale)
  const locationContent = resolveTranslatedField(ld?.content, tr, 'content', locale)

  // Resolve slot IDs to human-readable labels
  const slotLabel = resolveSlotLabels(booking.slot, ld?.slots as any, locale)

  const bookingContext: BookingEmailContext = {
    id: booking.id,
    teamId: booking.teamId,
    owner: booking.owner,
    location: booking.location,
    date: booking.date,
    slot: booking.slot,
    slotLabel,
    status: booking.status,
    locationData: ld
      ? {
          id: ld.id,
          name: locationTitle,
          title: locationTitle,
          street: locationStreet,
          city: locationCity,
          content: locationContent
        }
      : null,
    ownerUser: {
      id: user.id,
      name: user.name || 'Customer',
      email: user.email || ''
    },
    teamName: team.name,
    teamEmail: teamMetadata.email || teamMetadata.contactEmail || '',
    teamPhone: teamMetadata.phone || teamMetadata.contactPhone || ''
  }

  // Send email
  const result = await sendBookingEmails({
    booking: bookingContext,
    triggerType: triggerType as BookingEmailTriggerType,
    teamId: team.id,
    userId: user.id,
    locale,
    event
  })

  if (!result.success) {
    throw createError({
      status: 500,
      statusText: result.errors?.join(', ') || 'Failed to send email'
    })
  }

  return {
    success: true,
    message: `Email resent for trigger: ${triggerType}`,
    customerResult: result.customerResult,
    adminResult: result.adminResult
  }
})
