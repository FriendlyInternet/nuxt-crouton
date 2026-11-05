// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createCrateTrack } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  rekordboxId: z.string().min(1, 'rekordboxId is required'),
  name: z.string().min(1, 'name is required'),
  artist: z.string().nullish(),
  album: z.string().nullish(),
  genre: z.string().nullish(),
  year: z.number().nullish(),
  bpm: z.number().nullish(),
  tonality: z.string().nullish(),
  durationSec: z.number().nullish(),
  label: z.string().nullish(),
  dateAdded: z.coerce.date().nullish(),
  location: z.string().min(1, 'location is required'),
  audioPath: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  originalComments: z.string().nullish()
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
  if (dataWithoutId.dateAdded) {
    dataWithoutId.dateAdded = new Date(dataWithoutId.dateAdded)
  }
  const dbTimer = timing.start('db')
  const result = await createCrateTrack({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})