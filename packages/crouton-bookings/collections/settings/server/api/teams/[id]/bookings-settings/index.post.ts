// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { z } from 'zod'
import type { NewBookingsSetting } from '../../../../../types'
import { createBookingsSetting } from '../../../../database/queries'
import { requireCan } from '@fyit/crouton-auth/server/utils/team-auth'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  statuses: z.array(z.any()).nullish(),
  groups: z.array(z.any()).nullish(),
  sendEmails: z.boolean().optional()
}).strip()

export default defineEventHandler(async (event) => {
  const { team, user } = await requireCan(event, 'bookings:manage')

  const body = await readValidatedBody(event, bodySchema.parse)

  return await createBookingsSetting({
    ...body,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  } as NewBookingsSetting)
})
