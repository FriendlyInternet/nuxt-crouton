// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteBookingsEmailtemplate } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { emailtemplateId } = getRouterParams(event)
  if (!emailtemplateId) {
    throw createError({ status: 400, statusText: 'Missing emailtemplate ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  return await deleteBookingsEmailtemplate(emailtemplateId, team.id, user.id, { role: membership.role })
})