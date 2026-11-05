// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateCrateLookup } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  trackId: z.string().min(1, 'trackId is required'),
  fetchedAt: z.coerce.date(),
  results: z.record(z.string(), z.any()).nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { lookupId } = getRouterParams(event)
  if (!lookupId) {
    throw createError({ status: 400, statusText: 'Missing lookup ID' })
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
  const result = await updateCrateLookup(lookupId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})