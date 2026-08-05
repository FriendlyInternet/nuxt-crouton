// Marks a chore done and advances assignee to the next household member (#1937).
// Kept as a dedicated action endpoint (not overloaded onto PATCH) since the
// generated PATCH body schema has no "mark done" semantics — this is where
// lastDoneById/lastDoneAt/assigneeId are derived server-side, not client-supplied.
import { and, asc, eq } from 'drizzle-orm'
import { member as memberTable } from '@fyit/crouton-auth/server/database/schema/auth'
import { getChoresChoresByIds, updateChoresChore } from '../../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { getNextAssignee } from '../../../../../utils/rotation'

export default defineEventHandler(async (event) => {
  const { choreId } = getRouterParams(event)
  if (!choreId) {
    throw createError({ status: 400, statusText: 'Missing chore ID' })
  }

  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const [chore] = await getChoresChoresByIds(team.id, [choreId])
  if (!chore) {
    throw createError({ status: 404, statusText: 'ChoresChore not found' })
  }

  const db = useDB()
  const members = await (db as any)
    .select({ userId: memberTable.userId })
    .from(memberTable)
    .where(and(eq(memberTable.organizationId, team.id)))
    .orderBy(asc(memberTable.createdAt))

  const orderedMemberIds = members.map((m: { userId: string }) => m.userId)
  const nextAssigneeId = getNextAssignee(chore.assigneeId, orderedMemberIds)

  return await updateChoresChore(choreId, team.id, user.id, {
    assigneeId: nextAssigneeId,
    lastDoneById: chore.assigneeId,
    lastDoneAt: new Date()
  }, { role: membership.role })
})
