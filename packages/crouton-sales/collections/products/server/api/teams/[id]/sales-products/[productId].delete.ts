// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteSalesProduct } from '../../../../database/queries'
import { captureConfigWrite } from '../../../../../../../server/utils/config-capture'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { productId } = getRouterParams(event)
  if (!productId) {
    throw createError({ status: 400, statusText: 'Missing product ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const dbTimer = timing.start('db')
  const result = await deleteSalesProduct(productId, team.id, user.id, { role: membership.role })
  dbTimer.end()
  await captureConfigWrite(useDB(), { entityType: 'product', operation: 'delete', entityId: productId, teamId: team.id })
  return result
})