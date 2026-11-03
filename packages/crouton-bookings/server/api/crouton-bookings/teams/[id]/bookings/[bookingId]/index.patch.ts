/**
 * Update a booking - allows any team member to update bookings
 * (not restricted to owner like the generated CRUD endpoint)
 */
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { bookingsBookings } from '../../../../../../../collections/bookings/server/database/schema'

const updateSchema = z.object({
  location: z.string().optional(),
  date: z.string().optional(),
  slot: z.string().optional(),
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

  // Check booking exists and belongs to this team
  const [existing] = await db
    .select()
    .from(bookingsBookings)
    .where(
      and(
        eq(bookingsBookings.id as any, bookingId),
        eq(bookingsBookings.teamId as any, team.id),
      ),
    )

  if (!existing) {
    throw createError({
      status: 404,
      statusText: 'Booking not found',
    })
  }

  // Build update data
  const updateData: Record<string, unknown> = {
    updatedBy: user.id,
    updatedAt: new Date(),
  }

  if (parsed.data.location !== undefined) {
    updateData.location = parsed.data.location
  }
  if (parsed.data.date !== undefined) {
    updateData.date = new Date(parsed.data.date)
  }
  if (parsed.data.slot !== undefined) {
    updateData.slot = parsed.data.slot
  }
  if (parsed.data.group !== undefined) {
    updateData.group = parsed.data.group
  }
  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status
  }

  // Update the booking
  const [updated] = await db
    .update(bookingsBookings)
    .set(updateData as any)
    .where(eq(bookingsBookings.id as any, bookingId))
    .returning()

  return updated
})
