// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateTriageTask } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import type { TriageTask } from '../../../../../types'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { taskId } = getRouterParams(event)
  if (!taskId) {
    throw createError({ status: 400, statusText: 'Missing task ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody<Partial<TriageTask>>(event)

  const dbTimer = timing.start('db')
  const result = await updateTriageTask(taskId, team.id, user.id, {
    discussionId: body.discussionId,
    syncJobId: body.syncJobId,
    notionPageId: body.notionPageId,
    notionPageUrl: body.notionPageUrl,
    title: body.title,
    description: body.description,
    status: body.status,
    priority: body.priority,
    assignee: body.assignee,
    summary: body.summary,
    sourceUrl: body.sourceUrl,
    isMultiTaskChild: body.isMultiTaskChild,
    taskIndex: body.taskIndex,
    metadata: body.metadata
  }, { role: membership.role })
  dbTimer.end()
  return result
})