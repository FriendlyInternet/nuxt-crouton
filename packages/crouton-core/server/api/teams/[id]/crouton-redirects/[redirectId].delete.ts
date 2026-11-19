import { deleteCroutonRedirect } from '../../../../database/queries/redirects'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'
import { invalidateRedirectCache } from '../../../../utils/redirectCache'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { redirectId } = getRouterParams(event)
  if (!redirectId) {
    throw createError({ status: 400, statusText: 'Missing redirect ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user } = await requireCan(event, 'site:manage')
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteCroutonRedirect(redirectId, team.id, user.id, { seesAll: await can(team.id, user.id, 'site:manage', event) })
  dbTimer.end()

  invalidateRedirectCache()

  return result
})
