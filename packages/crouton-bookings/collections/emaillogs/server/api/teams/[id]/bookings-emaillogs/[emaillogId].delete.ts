// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { deleteBookingsEmaillog } from '../../../../database/queries'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { emaillogId } = getRouterParams(event)
  if (!emaillogId) {
    throw createError({ status: 400, statusText: 'Missing emaillog ID' })
  }
  const { team, user } = await requireCan(event, 'bookings:manage')

  return await deleteBookingsEmaillog(emaillogId, team.id, user.id, { seesAll: await can(team.id, user.id, 'bookings:manage', event) })
})