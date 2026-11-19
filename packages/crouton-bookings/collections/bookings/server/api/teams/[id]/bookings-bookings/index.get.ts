// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllBookingsBookings, getBookingsBookingsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

const isAdmin = (role?: string) => role === 'admin' || role === 'owner'

export default defineEventHandler(async (event) => {
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const scope = isAdmin(membership?.role) ? undefined : { ownerId: user.id }
  const query = getQuery(event)
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getBookingsBookingsByIds(team.id, ids, scope)
  }

  return await getAllBookingsBookings(team.id, scope)
})