// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { z } from 'zod'
import { updateBookingsEmaillog } from '../../../../database/queries'
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
}).partial().strip()

export default defineEventHandler(async (event) => {
  const { emaillogId } = getRouterParams(event)
  if (!emaillogId) {
    throw createError({ status: 400, statusText: 'Missing emaillog ID' })
  }
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const body = await readValidatedBody(event, bodySchema.parse)

  return await updateBookingsEmaillog(emaillogId, team.id, user.id, {
    bookingId: body.bookingId,
    templateId: body.templateId,
    recipientEmail: body.recipientEmail,
    triggerType: body.triggerType,
    status: body.status,
    sentAt: body.sentAt,
    error: body.error
  }, { role: membership.role })
})
