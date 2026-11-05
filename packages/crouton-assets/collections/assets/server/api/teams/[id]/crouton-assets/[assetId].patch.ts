// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateCroutonAsset } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { CroutonAsset } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const { assetId } = getRouterParams(event)
  if (!assetId) {
    throw createError({ status: 400, statusText: 'Missing asset ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readBody<Partial<CroutonAsset>>(event)

  // id, teamId, userId and updatedBy are server-owned: taking them from the
  // body let a member move an asset into another team (#2278).
  return await updateCroutonAsset(assetId, team.id, user.id, {
    filename: body.filename,
    pathname: body.pathname,
    contentType: body.contentType,
    size: body.size,
    category: body.category,
    width: body.width,
    height: body.height,
    alt: body.alt,
    uploadedAt: body.uploadedAt ? new Date(body.uploadedAt) : body.uploadedAt,
  }, { role: membership.role })
})