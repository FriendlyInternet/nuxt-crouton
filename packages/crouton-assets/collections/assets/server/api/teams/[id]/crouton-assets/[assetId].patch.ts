// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { updateCroutonAsset } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  filename: z.string().min(1),
  pathname: z.string().min(1),
  contentType: z.string().nullish(),
  size: z.number().int().nullish(),
  category: z.string().nullish(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  alt: z.string().nullish(),
  uploadedAt: z.coerce.date().nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const { assetId } = getRouterParams(event)
  if (!assetId) {
    throw createError({ status: 400, statusText: 'Missing asset ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  // id, teamId, userId and updatedBy are server-owned: taking them from the
  // body let a member move an asset into another team (#2278).
  return await updateCroutonAsset(assetId, team.id, user.id, {
    filename: body.filename,
    pathname: body.pathname,
    contentType: body.contentType ?? undefined,
    size: body.size ?? undefined,
    category: body.category ?? undefined,
    width: body.width ?? undefined,
    height: body.height ?? undefined,
    alt: body.alt ?? undefined,
    uploadedAt: body.uploadedAt
  }, { role: membership.role })
})
