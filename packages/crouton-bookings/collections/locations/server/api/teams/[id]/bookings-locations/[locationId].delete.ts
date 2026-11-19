// Team-based endpoint - requires @fyit/crouton-auth package
// The requireTeamAdmin utility handles team resolution and auth
import { deleteBookingsLocation } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }
  const { team, user, membership } = await requireTeamAdmin(event)

  return await deleteBookingsLocation(locationId, team.id, user.id, { role: membership.role })
})