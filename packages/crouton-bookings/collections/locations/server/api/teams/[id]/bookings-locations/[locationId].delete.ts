// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { deleteBookingsLocation } from '../../../../database/queries'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { locationId } = getRouterParams(event)
  if (!locationId) {
    throw createError({ status: 400, statusText: 'Missing location ID' })
  }
  const { team, user } = await requireCan(event, 'bookings:manage')

  return await deleteBookingsLocation(locationId, team.id, user.id, { seesAll: await can(team.id, user.id, 'bookings:manage', event) })
})