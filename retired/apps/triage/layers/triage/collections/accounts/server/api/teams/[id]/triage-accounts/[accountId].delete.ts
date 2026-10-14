// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteTriageAccount } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { accountId } = getRouterParams(event)
  if (!accountId) {
    throw createError({ status: 400, statusText: 'Missing account ID' })
  }
  const { team, user } = await resolveTeamAndCheckMembership(event)

  return await deleteTriageAccount(accountId, team.id, user.id)
})