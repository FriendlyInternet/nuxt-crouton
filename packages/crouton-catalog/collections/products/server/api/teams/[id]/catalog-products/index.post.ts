// Only a team admin may create a product; the team comes from the route, never the body.
import { z } from 'zod'
import { createCatalogProduct } from '../../../../database/queries'
import { requireTeamAdmin } from '@fyit/crouton-auth/server/utils/team'

// Body validation (#3377): wrong types -> 400, unknown/system keys are stripped.
const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  active: z.boolean().nullish(),
  translations: z.record(z.string(), z.object({
    title: z.string().optional(),
    description: z.string().optional()
  })).nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await requireTeamAdmin(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await createCatalogProduct({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createCatalogProduct>[0])
})
