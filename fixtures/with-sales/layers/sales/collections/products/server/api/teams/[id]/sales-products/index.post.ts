// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createSalesProduct } from '../../../../database/queries'
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
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — the database generates the id
  const dataWithoutId = body

  const dbTimer = timing.start('db')
  const result = await createSalesProduct({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})