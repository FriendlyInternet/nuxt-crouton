// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { createBookingsBooking, assertBookingsBookingReferences } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377): wrong types -> 400, unknown/system keys are stripped.
const bodySchema = z.object({
  location: z.string().min(1),
  date: z.coerce.date(),
  slot: z.array(z.string()).min(1),
  group: z.string().nullish(),
  quantity: z.number().int(),
  status: z.string().min(1)
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  await assertBookingsBookingReferences(team.id, body)
  return await createBookingsBooking({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as Parameters<typeof createBookingsBooking>[0])
})
