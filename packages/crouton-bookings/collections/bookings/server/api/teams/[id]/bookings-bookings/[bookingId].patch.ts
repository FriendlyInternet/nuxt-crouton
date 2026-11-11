// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
// Hand-edited (#3379): moving or re-activating a booking re-checks capacity.
import { z } from 'zod'
import { assertBookingsBookingReferences } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { patchBookingGuarded } from '../../../../../../../server/utils/booking-capacity'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  location: z.string().min(1),
  date: z.coerce.date(),
  slot: z.array(z.string()).min(1),
  group: z.string().nullish(),
  quantity: z.number().int(),
  status: z.string().min(1)
}).partial().strip()

export default defineEventHandler(async (event) => {
  const { bookingId } = getRouterParams(event)
  if (!bookingId) {
    throw createError({ status: 400, statusText: 'Missing booking ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)
  const isAdmin = membership.role === 'admin' || membership.role === 'owner'
  const tz: string = (useRuntimeConfig(event) as any)?.croutonBookings?.timezone || 'Europe/Brussels'

  await assertBookingsBookingReferences(team.id, body)

  return await patchBookingGuarded(useDB(), {
    teamId: team.id,
    bookingId,
    userId: user.id,
    ownerId: isAdmin ? undefined : user.id,
    tz,
    patch: {
      location: body.location,
      date: body.date as any,
      slot: body.slot,
      group: body.group,
      quantity: body.quantity,
      status: body.status,
    },
  })
})
