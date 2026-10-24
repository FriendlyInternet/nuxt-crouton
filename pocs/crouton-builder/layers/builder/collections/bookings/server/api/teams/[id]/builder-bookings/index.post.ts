// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createBuilderBooking } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  artist: z.string().min(1, 'artist is required'),
  venue: z.string().min(1, 'venue is required'),
  date: z.coerce.date(),
  fee: z.number().optional(),
  status: z.string().min(1, 'status is required')
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
  if (dataWithoutId.date) {
    dataWithoutId.date = new Date(dataWithoutId.date)
  }
  const dbTimer = timing.start('db')
  const result = await createBuilderBooking({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})