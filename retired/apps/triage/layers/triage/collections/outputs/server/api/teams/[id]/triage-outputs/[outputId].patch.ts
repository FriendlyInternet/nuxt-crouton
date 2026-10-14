// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageOutput } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageOutput } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { outputId } = getRouterParams(event)
  if (!outputId) {
    throw createError({ status: 400, statusText: 'Missing output ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageOutput>>(event)

  const dbTimer = timing.start('db')
  const result = await updateTriageOutput(outputId, team.id, user.id, {
    flowId: body.flowId,
    outputType: body.outputType,
    name: body.name,
    accountId: body.accountId,
    domainFilter: body.domainFilter,
    isDefault: body.isDefault,
    outputConfig: body.outputConfig,
    active: body.active
  }, { role: membership.role })
  dbTimer.end()
  return result
})