// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteBookingsBooking } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { bookingId } = getRouterParams(event)
  if (!bookingId) {
    throw createError({ status: 400, statusText: 'Missing booking ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  return await deleteBookingsBooking(bookingId, team.id, user.id, { role: membership.role })
})