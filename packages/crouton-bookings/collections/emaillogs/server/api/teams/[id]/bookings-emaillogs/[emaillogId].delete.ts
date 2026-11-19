// Team-based endpoint - requires @fyit/crouton-auth package
// The requireTeamAdmin utility handles team resolution and auth
import { deleteBookingsEmaillog } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { emaillogId } = getRouterParams(event)
  if (!emaillogId) {
    throw createError({ status: 400, statusText: 'Missing emaillog ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  return await deleteBookingsEmaillog(emaillogId, team.id, user.id, { role: membership.role })
})