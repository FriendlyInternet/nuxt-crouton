// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createTriageJob } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readBody(event)

  // Exclude id field to let the database generate it
  const { id, ...dataWithoutId } = body

  // Convert date string to Date object
  if (dataWithoutId.startedAt) {
    dataWithoutId.startedAt = new Date(dataWithoutId.startedAt)
  }
  // Convert date string to Date object
  if (dataWithoutId.completedAt) {
    dataWithoutId.completedAt = new Date(dataWithoutId.completedAt)
  }
  const dbTimer = timing.start('db')
  const result = await createTriageJob({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})