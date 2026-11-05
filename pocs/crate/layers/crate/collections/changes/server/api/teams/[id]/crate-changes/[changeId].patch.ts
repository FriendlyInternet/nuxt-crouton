// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateCrateChange } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  groupId: z.string().min(1, 'groupId is required'),
  trackId: z.string().min(1, 'trackId is required'),
  before: z.array(z.string()).nullish(),
  after: z.array(z.string()).nullish(),
  summary: z.string().nullish(),
  undoOf: z.string().nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { changeId } = getRouterParams(event)
  if (!changeId) {
    throw createError({ status: 400, statusText: 'Missing change ID' })
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
  const result = await updateCrateChange(changeId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})