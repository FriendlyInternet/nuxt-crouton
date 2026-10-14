// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteCategorizeCategorizeLayout } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { categorizeLayoutId } = getRouterParams(event)
  if (!categorizeLayoutId) {
    throw createError({ status: 400, statusText: 'Missing categorize-layout ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteCategorizeCategorizeLayout(categorizeLayoutId, team.id, user.id, { role: membership.role })
  dbTimer.end()
  return result
})