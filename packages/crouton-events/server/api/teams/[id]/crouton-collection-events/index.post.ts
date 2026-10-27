import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { croutonEvents } from '../../../../database/schema'

export default defineEventHandler(async (event) => {
  const { team, user } = await resolveTeamAndCheckMembership(event)
  const db = useDB()
  const body = await readBody(event)

  const { id: _id, teamId: _teamId, userId: _userId, ...rest } = body

  await db.insert(croutonEvents).values({
    ...rest,
    id: crypto.randomUUID(),
    teamId: team.id,
    userId: user.id,
    timestamp: rest.timestamp ? new Date(rest.timestamp) : new Date()
  })

  return { success: true }
})
