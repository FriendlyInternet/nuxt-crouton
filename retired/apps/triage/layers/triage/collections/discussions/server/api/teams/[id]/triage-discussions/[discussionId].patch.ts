// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageDiscussion } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageDiscussion } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { discussionId } = getRouterParams(event)
  if (!discussionId) {
    throw createError({ status: 400, statusText: 'Missing discussion ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageDiscussion>>(event)

  const dbTimer = timing.start('db')
  const result = await updateTriageDiscussion(discussionId, team.id, user.id, {
    sourceType: body.sourceType,
    sourceThreadId: body.sourceThreadId,
    sourceUrl: body.sourceUrl,
    flowInputId: body.flowInputId,
    title: body.title,
    content: body.content,
    authorHandle: body.authorHandle,
    participants: body.participants,
    status: body.status,
    threadData: body.threadData,
    totalMessages: body.totalMessages,
    aiSummary: body.aiSummary,
    aiKeyPoints: body.aiKeyPoints,
    aiTasks: body.aiTasks,
    isMultiTask: body.isMultiTask,
    syncJobId: body.syncJobId,
    notionTaskIds: body.notionTaskIds,
    rawPayload: body.rawPayload,
    metadata: body.metadata,
    processedAt: body.processedAt ? new Date(body.processedAt) : body.processedAt
  }, { role: membership.role })
  dbTimer.end()
  return result
})