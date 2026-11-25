// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllBookingsBookings, getBookingsBookingsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  // bookings:manage sees the whole team; everyone else only their own bookings
  const scope = (await can(team.id, user.id, 'bookings:manage', event)) ? undefined : { ownerId: user.id }
  const query = getQuery(event)
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getBookingsBookingsByIds(team.id, ids, scope)
  }

  return await getAllBookingsBookings(team.id, scope)
})