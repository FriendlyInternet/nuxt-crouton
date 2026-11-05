import { deleteCroutonRedirect } from '../../../../database/queries/redirects'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { invalidateRedirectCache } from '../../../../utils/redirectCache'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { redirectId } = getRouterParams(event)
  if (!redirectId) {
    throw createError({ status: 400, statusText: 'Missing redirect ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await requireTeamAdmin(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteCroutonRedirect(redirectId, team.id, user.id, { role: membership.role })
  dbTimer.end()

  invalidateRedirectCache()

  return result
})
