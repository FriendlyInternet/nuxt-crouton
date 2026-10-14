// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageMessage } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageMessage } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { messageId } = getRouterParams(event)
  if (!messageId) {
    throw createError({ status: 400, statusText: 'Missing message ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageMessage>>(event)

  const dbTimer = timing.start('db')
  const result = await updateTriageMessage(messageId, team.id, user.id, {
    flowInputId: body.flowInputId,
    messageType: body.messageType,
    from: body.from,
    to: body.to,
    subject: body.subject,
    htmlBody: body.htmlBody,
    textBody: body.textBody,
    receivedAt: body.receivedAt ? new Date(body.receivedAt) : body.receivedAt,
    read: body.read,
    forwardedTo: body.forwardedTo,
    forwardedAt: body.forwardedAt ? new Date(body.forwardedAt) : body.forwardedAt,
    resendEmailId: body.resendEmailId
  }, { role: membership.role })
  dbTimer.end()
  return result
})