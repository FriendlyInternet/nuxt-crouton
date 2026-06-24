// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteBookingsSetting } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { settingId } = getRouterParams(event)
  if (!settingId) {
    throw createError({ status: 400, statusText: 'Missing setting ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteBookingsSetting(settingId, team.id, user.id, { role: membership.role })
  dbTimer.end()
  return result
})