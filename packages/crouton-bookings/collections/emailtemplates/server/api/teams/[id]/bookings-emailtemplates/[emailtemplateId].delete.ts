// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { deleteBookingsEmailtemplate } from '../../../../database/queries'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { emailtemplateId } = getRouterParams(event)
  if (!emailtemplateId) {
    throw createError({ status: 400, statusText: 'Missing emailtemplate ID' })
  }
  const { team, user } = await requireCan(event, 'bookings:manage')

  return await deleteBookingsEmailtemplate(emailtemplateId, team.id, user.id, { seesAll: await can(team.id, user.id, 'bookings:manage', event) })
})