import { createCroutonRedirect } from '../../../../database/queries/redirects'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'
import { validateRedirectInput } from '../../../../utils/redirectValidation'
import { invalidateRedirectCache } from '../../../../utils/redirectCache'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await requireTeamAdmin(event)
  authTimer.end()

  const body = validateRedirectInput(await readBody(event))

  const dbTimer = timing.start('db')
  const result = await createCroutonRedirect({
    ...body,
    statusCode: body.statusCode ?? '301',
    isActive: body.isActive ?? true,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()

  invalidateRedirectCache()

  return result
})
