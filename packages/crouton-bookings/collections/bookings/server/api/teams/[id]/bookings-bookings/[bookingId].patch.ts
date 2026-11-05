// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
// Hand-edited (#3379): moving or re-activating a booking re-checks capacity.
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { BookingsBooking } from '../../../../../types'
import { patchBookingGuarded } from '../../../../../../../server/utils/booking-capacity'

export default defineEventHandler(async (event) => {
  const { bookingId } = getRouterParams(event)
  if (!bookingId) {
    throw createError({ status: 400, statusText: 'Missing booking ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<Partial<BookingsBooking>>(event)
  const isAdmin = membership.role === 'admin' || membership.role === 'owner'
  const tz: string = (useRuntimeConfig(event) as any)?.croutonBookings?.timezone || 'Europe/Brussels'

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
