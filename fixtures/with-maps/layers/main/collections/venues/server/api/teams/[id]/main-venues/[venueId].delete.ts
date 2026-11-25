// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteMainVenue } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { venueId } = getRouterParams(event)
  if (!venueId) {
    throw createError({ status: 400, statusText: 'Missing venue ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteMainVenue(venueId, team.id, user.id, { seesAll: await can(team.id, user.id, 'collections:manage', event) })
  dbTimer.end()
  return result
})