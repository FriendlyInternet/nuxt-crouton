// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateSalesProduct } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  categoryId: z.string().optional(),
  locationId: z.string().optional(),
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  price: z.number(),
  isActive: z.boolean().optional(),
  requiresRemark: z.boolean().optional(),
  remarkPrompt: z.string().optional(),
  hasOptions: z.boolean().optional(),
  multipleOptionsAllowed: z.boolean().optional(),
  options: z.array(z.any()).optional()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { productId } = getRouterParams(event)
  if (!productId) {
    throw createError({ status: 400, statusText: 'Missing product ID' })
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
  const result = await updateSalesProduct(productId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})