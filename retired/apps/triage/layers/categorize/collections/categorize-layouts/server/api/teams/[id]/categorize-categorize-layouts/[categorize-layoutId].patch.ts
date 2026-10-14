// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateCategorizeCategorizeLayout } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { CategorizeCategorizeLayout } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { categorizeLayoutId } = getRouterParams(event)
  if (!categorizeLayoutId) {
    throw createError({ status: 400, statusText: 'Missing categorize-layout ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<CategorizeCategorizeLayout>>(event)

  const dbTimer = timing.start('db')
  const result = await updateCategorizeCategorizeLayout(categorizeLayoutId, team.id, user.id, {
    name: body.name,
    databaseId: body.databaseId,
    accountId: body.accountId,
    categoryProperty: body.categoryProperty,
    layout: body.layout
  }, { role: membership.role })
  dbTimer.end()
  return result
})