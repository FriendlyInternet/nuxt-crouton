/**
 * Update a booking - the owner or a team admin (#3135). Other members get 403.
 */
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { patchBookingGuarded } from '../../../../../../utils/booking-capacity'
import { bookingsBookings } from '../../../../../../../collections/bookings/server/database/schema'
import { bookingsLocations } from '../../../../../../../collections/locations/server/database/schema'

const updateSchema = z.object({
  location: z.string().optional(),
  date: z.string().optional(),
  slot: z.union([z.string(), z.array(z.string())]).optional(),
  group: z.string().nullable().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
})

export default defineEventHandler(async (event) => {
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const bookingId = getRouterParam(event, 'bookingId')
  if (!bookingId) {
    throw createError({
      status: 400,
      statusText: 'Booking ID is required',
    })
  }

  const isAdmin = membership?.role === 'admin' || membership?.role === 'owner'
  if (!isAdmin) {
    const [existing] = await db.select({ owner: bookingsBookings.owner }).from(bookingsBookings)
      .where(and(eq(bookingsBookings.id as any, bookingId), eq(bookingsBookings.teamId as any, team.id)))
    if (existing && existing.owner !== user.id) {
      throw createError({ status: 403, statusText: 'Not your booking' })
    }
  }

  // Validate body
  const body = await readBody(event)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      status: 400,
      statusText: 'Invalid request body',
      data: parsed.error.issues,
    })
  }

  // A booking may only point at its own team's location (#3378)
  await assertRefsInTeam(db, team.id, [
    { field: 'location', table: bookingsLocations, value: parsed.data.location },
  ])

  // Capacity is re-checked when the booking moves or comes back from cancelled (#3379)
  const tz: string = (useRuntimeConfig(event) as any)?.croutonBookings?.timezone || 'Europe/Brussels'
  return await patchBookingGuarded(db, {
    teamId: team.id,
    bookingId,
    userId: user.id,
    ownerId: isAdmin ? undefined : user.id,
    tz,
    patch: parsed.data,
  })
})
