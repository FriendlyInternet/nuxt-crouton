// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { createBookingsEmaillog, assertBookingsEmaillogReferences } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  bookingId: z.string().nullish(),
  templateId: z.string().nullish(),
  recipientEmail: z.string().min(1),
  triggerType: z.string().min(1),
  status: z.string().min(1),
  sentAt: z.string().nullish(),
  error: z.string().nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  await assertBookingsEmaillogReferences(team.id, body)


  return await createBookingsEmaillog({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createBookingsEmaillog>[0])
})
