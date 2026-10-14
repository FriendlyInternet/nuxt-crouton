// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllCategorizeCategorizeLayouts, getCategorizeCategorizeLayoutsByIds, getCategorizeCategorizeLayoutByFilter } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const query = getQuery(event)

  const dbTimer = timing.start('db')

  // Filter by databaseId + accountId for layout lookup
  if (query.databaseId && query.accountId) {
    const result = await getCategorizeCategorizeLayoutByFilter(team.id, String(query.databaseId), String(query.accountId))
    dbTimer.end()
    return result
  }

  if (query.ids) {
    const ids = String(query.ids).split(',')
    const result = await getCategorizeCategorizeLayoutsByIds(team.id, ids)
    dbTimer.end()
    return result
  }

  const result = await getAllCategorizeCategorizeLayouts(team.id)
  dbTimer.end()
  return result
})