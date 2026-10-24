// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { reorderSiblingsPagesPages } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody(event)

  // Validate input - expect array of { id, order }
  if (!Array.isArray(body.updates)) {
    throw createError({ status: 400, statusText: 'updates must be an array' })
  }

  for (const update of body.updates) {
    if (!update.id || typeof update.order !== 'number') {
      throw createError({
        status: 400,
        statusText: 'Each update must have id and order (number)'
      })
    }
  }

  const dbTimer = timing.start('db')
  const result = await reorderSiblingsPagesPages(team.id, body.updates)
  dbTimer.end()
  return result
})