// Team-based endpoint - requires @fyit/crouton-auth package
// The requireCan utility handles team resolution and auth
import { z } from 'zod'
import { updateBookingsSetting } from '../../../../database/queries'
import { requireCan, can } from '@fyit/crouton-auth/server/utils/team-auth'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  statuses: z.array(z.any()).nullish(),
  groups: z.array(z.any()).nullish(),
  sendEmails: z.boolean().optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const { settingId } = getRouterParams(event)
  if (!settingId) {
    throw createError({ status: 400, statusText: 'Missing setting ID' })
  }
  const { team, user } = await requireCan(event, 'bookings:manage')

  const body = await readValidatedBody(event, bodySchema.parse)

  return await updateBookingsSetting(settingId, team.id, user.id, {
    statuses: body.statuses,
    groups: body.groups,
    sendEmails: body.sendEmails
  } as Parameters<typeof updateBookingsSetting>[3], { seesAll: await can(team.id, user.id, 'bookings:manage', event) })
})
