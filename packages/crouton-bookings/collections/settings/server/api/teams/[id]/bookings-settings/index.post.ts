// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import type { NewBookingsSetting } from '../../../../../types'
import { createBookingsSetting } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  statuses: z.array(z.any()).nullish(),
  groups: z.array(z.any()).nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await createBookingsSetting({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as NewBookingsSetting)
})
