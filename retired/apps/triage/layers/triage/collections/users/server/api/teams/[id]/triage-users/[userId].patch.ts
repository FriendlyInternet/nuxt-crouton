// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageUser } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageUser } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { userId } = getRouterParams(event)
  if (!userId) {
    throw createError({ status: 400, statusText: 'Missing user ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageUser>>(event)

  const dbTimer = timing.start('db')
  const result = await updateTriageUser(userId, team.id, user.id, {
    sourceType: body.sourceType,
    sourceWorkspaceId: body.sourceWorkspaceId,
    sourceUserId: body.sourceUserId,
    sourceUserEmail: body.sourceUserEmail,
    sourceUserName: body.sourceUserName,
    notionUserId: body.notionUserId,
    notionUserName: body.notionUserName,
    notionUserEmail: body.notionUserEmail,
    mappingType: body.mappingType,
    confidence: body.confidence,
    active: body.active,
    lastSyncedAt: body.lastSyncedAt,
    metadata: body.metadata
  }, { role: membership.role })
  dbTimer.end()
  return result
})