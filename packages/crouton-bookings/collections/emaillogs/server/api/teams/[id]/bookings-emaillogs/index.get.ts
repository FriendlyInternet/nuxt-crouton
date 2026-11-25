// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { getAllBookingsEmaillogs, getBookingsEmaillogsByIds } from '../../../../database/queries'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'

export default defineEventHandler(async (event) => {
  const { team } = await requireCan(event, 'bookings:manage')

  const query = getQuery(event)
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getBookingsEmaillogsByIds(team.id, ids)
  }

  return await getAllBookingsEmaillogs(team.id)
})