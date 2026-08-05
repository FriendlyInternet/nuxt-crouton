// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateBuilderBooking } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  artist: z.string().min(1, 'artist is required'),
  venue: z.string().min(1, 'venue is required'),
  date: z.coerce.date(),
  fee: z.number().optional(),
  status: z.string().min(1, 'status is required')
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { bookingId } = getRouterParams(event)
  if (!bookingId) {
    throw createError({ status: 400, statusText: 'Missing booking ID' })
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
  const result = await updateBuilderBooking(bookingId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})