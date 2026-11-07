// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { createBookingsEmailtemplate, assertBookingsEmailtemplateReferences } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377). No .min(1) on fromEmail: the admin page starts it as ''.
const bodySchema = z.object({
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  fromEmail: z.string(),
  triggerType: z.string(),
  recipientType: z.string(),
  isActive: z.boolean().nullish(),
  daysOffset: z.number().int().nullish(),
  locationId: z.string().nullish(),
  translations: z.record(z.string(), z.object({
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional()
  })).nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  await assertBookingsEmailtemplateReferences(team.id, body)


  return await createBookingsEmailtemplate({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createBookingsEmailtemplate>[0])
})
