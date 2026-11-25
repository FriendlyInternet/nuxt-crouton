// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { deleteBookingsSetting } from '../../../../database/queries'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { settingId } = getRouterParams(event)
  if (!settingId) {
    throw createError({ status: 400, statusText: 'Missing setting ID' })
  }
  const { team, user } = await requireCan(event, 'bookings:manage')

  return await deleteBookingsSetting(settingId, team.id, user.id, { seesAll: await can(team.id, user.id, 'bookings:manage', event) })
})