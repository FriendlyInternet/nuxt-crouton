// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateSalesOrder } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  eventOrderNumber: z.number().optional(),
  overallRemarks: z.string().optional(),
  locationRemarks: z.record(z.string(), z.any()).nullish(),
  isPersonnel: z.boolean().optional(),
  status: z.string().min(1, 'status is required')
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { orderId } = getRouterParams(event)
  if (!orderId) {
    throw createError({ status: 400, statusText: 'Missing order ID' })
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
  const result = await updateSalesOrder(orderId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})