// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateChoresChore } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  cadence: z.string().min(1, 'cadence is required'),
  assigneeId: z.string().min(1, 'assigneeId is required'),
  lastDoneById: z.string().nullish(),
  lastDoneAt: z.coerce.date().nullish(),
  notes: z.string().nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { choreId } = getRouterParams(event)
  if (!choreId) {
    throw createError({ status: 400, statusText: 'Missing chore ID' })
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
  const result = await updateChoresChore(choreId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})