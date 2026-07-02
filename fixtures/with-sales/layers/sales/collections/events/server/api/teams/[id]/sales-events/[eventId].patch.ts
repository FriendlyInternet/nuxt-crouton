// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateSalesEvent } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  title: z.string().min(1, 'title is required'),
  slug: z.string().min(1, 'slug is required'),
  description: z.string().optional(),
  eventType: z.string().optional(),
  startDate: z.coerce.date().nullish(),
  endDate: z.coerce.date().nullish(),
  status: z.string().min(1, 'status is required'),
  isCurrent: z.boolean().optional(),
  requiresClient: z.boolean().optional(),
  helperPin: z.string().optional(),
  currency: z.string().optional(),
  metadata: z.record(z.string(), z.any()).nullish(),
  archivedAt: z.coerce.date().nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { eventId } = getRouterParams(event)
  if (!eventId) {
    throw createError({ status: 400, statusText: 'Missing event ID' })
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
  const result = await updateSalesEvent(eventId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})