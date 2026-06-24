// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createSalesPrinter } from '../../../../database/queries'
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
  const result = await createSalesPrinter({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})