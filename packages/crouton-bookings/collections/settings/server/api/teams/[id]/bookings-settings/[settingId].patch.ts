// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { updateBookingsSetting } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

// Hand-added body validation (#3377)
const bodySchema = z.object({
  statuses: z.array(z.any()).nullish(),
  groups: z.array(z.any()).nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const { settingId } = getRouterParams(event)
  if (!settingId) {
    throw createError({ status: 400, statusText: 'Missing setting ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await updateBookingsSetting(settingId, team.id, user.id, {
    statuses: body.statuses,
    groups: body.groups
  } as Parameters<typeof updateBookingsSetting>[3], { role: membership.role })
})
