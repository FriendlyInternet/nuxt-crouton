// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllBookingsLocations, getBookingsLocationsByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const query = getQuery(event)
  // Accept locale for future translation handling
  const locale = String(query.locale || 'en')

  const dbTimer = timing.start('db')
  if (query.ids) {
    const ids = String(query.ids).split(',')
    const result = await getBookingsLocationsByIds(team.id, ids)
    dbTimer.end()
    return result
  }

  // Opt-in pagination: ?page=1&pageSize=10 → { items, total, page, pageSize }
  if (query.page !== undefined) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 10))
    const { items, total } = await getAllBookingsLocations(team.id, { limit: pageSize, offset: (page - 1) * pageSize })
    dbTimer.end()
    return { items, total, page, pageSize }
  }

  const result = await getAllBookingsLocations(team.id)
  dbTimer.end()
  return result
})