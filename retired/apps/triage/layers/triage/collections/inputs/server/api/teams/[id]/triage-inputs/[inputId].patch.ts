// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageInput } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageInput } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { inputId } = getRouterParams(event)
  if (!inputId) {
    throw createError({ status: 400, statusText: 'Missing input ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageInput>>(event)

  // Encrypt apiToken if provided as plaintext (not already encrypted)
  let apiToken = body.apiToken
  if (apiToken && !isEncryptedSecret(apiToken)) {
    apiToken = await encryptSecret(apiToken)
  }

  const dbTimer = timing.start('db')
  const result = await updateTriageInput(inputId, team.id, user.id, {
    flowId: body.flowId,
    sourceType: body.sourceType,
    name: body.name,
    apiToken,
    accountId: body.accountId,
    webhookUrl: body.webhookUrl,
    webhookSecret: body.webhookSecret,
    emailAddress: body.emailAddress,
    emailSlug: body.emailSlug,
    sourceMetadata: body.sourceMetadata,
    active: body.active
  }, { role: membership.role })
  dbTimer.end()
  return result
})