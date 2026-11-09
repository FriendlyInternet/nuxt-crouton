/**
 * Update a booking - allows any team member to update bookings
 * (not restricted to owner like the generated CRUD endpoint)
 */
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { patchBookingGuarded } from '../../../../../../utils/booking-capacity'
import { bookingsLocations } from '../../../../../../../collections/locations/server/database/schema'

const updateSchema = z.object({
  location: z.string().optional(),
  date: z.string().optional(),
  slot: z.union([z.string(), z.array(z.string())]).optional(),
  group: z.string().nullable().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled']).optional(),
})

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const bookingId = getRouterParam(event, 'bookingId')
  if (!bookingId) {
    throw createError({
      status: 400,
      statusText: 'Booking ID is required',
    })
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
    tz,
    patch: parsed.data,
  })
})
