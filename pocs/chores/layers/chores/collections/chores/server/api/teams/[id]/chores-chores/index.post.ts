// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createChoresChore } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  cadence: z.string().min(1, 'cadence is required'),
  assigneeId: z.string().min(1, 'assigneeId is required'),
  lastDoneById: z.string().nullish(),
  lastDoneAt: z.coerce.date().nullish(),
  notes: z.string().nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — the database generates the id
  const dataWithoutId = body

  // Convert date string to Date object
  if (dataWithoutId.lastDoneAt) {
    dataWithoutId.lastDoneAt = new Date(dataWithoutId.lastDoneAt)
  }
  const dbTimer = timing.start('db')
  const result = await createChoresChore({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})