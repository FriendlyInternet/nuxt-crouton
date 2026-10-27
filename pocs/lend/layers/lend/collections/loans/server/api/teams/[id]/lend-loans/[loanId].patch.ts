// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateLendLoan } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  itemName: z.string().min(1, 'itemName is required'),
  borrowerName: z.string().min(1, 'borrowerName is required'),
  lentDate: z.coerce.date(),
  expectedBackDate: z.coerce.date().nullish(),
  returned: z.boolean(),
  notes: z.string().nullish()
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { loanId } = getRouterParams(event)
  if (!loanId) {
    throw createError({ status: 400, statusText: 'Missing loan ID' })
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
  const result = await updateLendLoan(loanId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})