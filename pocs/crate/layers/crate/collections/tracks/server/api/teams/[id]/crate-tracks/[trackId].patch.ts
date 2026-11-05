// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateCrateTrack } from '../../../../database/queries'
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
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { trackId } = getRouterParams(event)
  if (!trackId) {
    throw createError({ status: 400, statusText: 'Missing track ID' })
  }

  const authTimer = timing.start('auth')
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // Only include fields that were actually sent in the request
  const updates: Record<string, any> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      updates[key] = value
    }
  }

  const dbTimer = timing.start('db')
  const result = await updateCrateTrack(trackId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})