// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateSalesPrinter } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  locationId: z.string().min(1, 'locationId is required'),
  title: z.string().min(1, 'title is required'),
  ipAddress: z.string().min(1, 'ipAddress is required'),
  port: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  driver: z.string().optional(),
  config: z.record(z.string(), z.any()).nullish(),
  showPrices: z.boolean().optional(),
  isActive: z.boolean().optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { printerId } = getRouterParams(event)
  if (!printerId) {
    throw createError({ status: 400, statusText: 'Missing printer ID' })
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
  const result = await updateSalesPrinter(printerId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})