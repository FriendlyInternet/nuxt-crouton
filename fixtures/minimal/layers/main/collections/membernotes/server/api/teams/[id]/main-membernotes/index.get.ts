// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { getAllMainMembernotes, getMainMembernotesByIds } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  // list: 'own' — admins/owners see the whole team, members only their own rows
  const ownerId = membership.role === 'admin' || membership.role === 'owner' ? undefined : user.id

  const query = getQuery(event)

  const dbTimer = timing.start('db')
  if (query.ids) {
    const ids = String(query.ids).split(',')
    const result = await getMainMembernotesByIds(team.id, ids, ownerId)
    dbTimer.end()
    return result
  }

  // Opt-in pagination: ?page=1&pageSize=10 → { items, total, page, pageSize }
  if (query.page !== undefined) {
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 10))
    const { items, total } = await getAllMainMembernotes(team.id, { owner: query.owner ? String(query.owner) : undefined, createdBy: query.createdBy ? String(query.createdBy) : undefined, updatedBy: query.updatedBy ? String(query.updatedBy) : undefined, limit: pageSize, offset: (page - 1) * pageSize, ownerId })
    dbTimer.end()
    return { items, total, page, pageSize }
  }

  const result = await getAllMainMembernotes(team.id, { owner: query.owner ? String(query.owner) : undefined, createdBy: query.createdBy ? String(query.createdBy) : undefined, updatedBy: query.updatedBy ? String(query.updatedBy) : undefined, ownerId })
  dbTimer.end()
  return result
})