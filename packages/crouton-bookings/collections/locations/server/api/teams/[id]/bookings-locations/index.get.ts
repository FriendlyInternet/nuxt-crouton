// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllBookingsLocations, getBookingsLocationsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)

  const query = getQuery(event)
  // Accept locale for future translation handling
  const locale = String(query.locale || 'en')
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getBookingsLocationsByIds(team.id, ids)
  }

  return await getAllBookingsLocations(team.id)
})