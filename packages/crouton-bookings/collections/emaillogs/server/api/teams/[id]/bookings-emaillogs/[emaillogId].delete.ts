// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteBookingsEmaillog } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { emaillogId } = getRouterParams(event)
  if (!emaillogId) {
    throw createError({ status: 400, statusText: 'Missing emaillog ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  return await deleteBookingsEmaillog(emaillogId, team.id, user.id, { role: membership.role })
})