// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { deleteCroutonAsset } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const { assetId } = getRouterParams(event)
  if (!assetId) {
    throw createError({ status: 400, statusText: 'Missing asset ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  return await deleteCroutonAsset(assetId, team.id, user.id, { role: membership.role })
})