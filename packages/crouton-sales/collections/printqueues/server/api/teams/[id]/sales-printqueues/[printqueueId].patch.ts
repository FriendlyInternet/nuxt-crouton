// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateSalesPrintqueue } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  orderId: z.string().min(1, 'orderId is required'),
  printerId: z.string().min(1, 'printerId is required'),
  locationId: z.string().optional(),
  status: z.string().min(1, 'status is required'),
  printData: z.string().min(1, 'printData is required'),
  printMode: z.string().optional(),
  errorMessage: z.string().optional(),
  retryCount: z.string().optional(),
  completedAt: z.string().optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { printqueueId } = getRouterParams(event)
  if (!printqueueId) {
    throw createError({ status: 400, statusText: 'Missing printqueue ID' })
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
  const result = await updateSalesPrintqueue(printqueueId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})