// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteSalesEvent } from '../../../../database/queries'
import { captureConfigWrite } from '../../../../../../../server/utils/config-capture'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { eventId } = getRouterParams(event)
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Missing event ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteSalesEvent(eventId, team.id, user.id, { seesAll: await can(team.id, user.id, 'collections:manage', event) })
  dbTimer.end()
  await captureConfigWrite(useDB(), { entityType: 'event', operation: 'delete', entityId: eventId, teamId: team.id })
  return result
})