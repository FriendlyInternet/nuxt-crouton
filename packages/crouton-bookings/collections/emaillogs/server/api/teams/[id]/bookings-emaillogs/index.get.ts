// Team-based endpoint - requires @fyit/crouton-auth package
// The requireTeamAdmin utility handles team resolution and auth
import { getAllBookingsEmaillogs, getBookingsEmaillogsByIds } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { team } = await requireTeamAdmin(event)

  const query = getQuery(event)
  if (query.ids) {
    const ids = String(query.ids).split(',')
    return await getBookingsEmaillogsByIds(team.id, ids)
  }

  return await getAllBookingsEmaillogs(team.id)
})