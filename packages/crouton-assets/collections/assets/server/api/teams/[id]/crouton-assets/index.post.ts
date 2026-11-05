// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { createCroutonAsset } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377). teamId/userId are server-owned, not accepted from the body.
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
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await createCroutonAsset({
    ...body,
    teamId: team.id,
    userId: user.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
})
