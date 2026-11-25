import { updateCroutonRedirect } from '../../../../database/queries/redirects'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'
import { invalidateRedirectCache } from '../../../../utils/redirectCache'
import { validateRedirectInput } from '../../../../utils/redirectValidation'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { redirectId } = getRouterParams(event)
  if (!redirectId) {
    throw createError({ status: 400, statusText: 'Missing redirect ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user } = await requireCan(event, 'site:manage')
  authTimer.end()

  const body = validateRedirectInput(await readBody(event), true)

  const dbTimer = timing.start('db')
  const result = await updateCroutonRedirect(redirectId, team.id, user.id, {
    fromPath: body.fromPath,
    toPath: body.toPath,
    statusCode: body.statusCode,
    isActive: body.isActive
  }, { seesAll: await can(team.id, user.id, 'site:manage', event) })
  dbTimer.end()

  invalidateRedirectCache()

  return result
})
