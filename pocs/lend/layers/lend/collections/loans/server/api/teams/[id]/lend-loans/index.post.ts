// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createLendLoan } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  itemName: z.string().min(1, 'itemName is required'),
  borrowerName: z.string().min(1, 'borrowerName is required'),
  lentDate: z.coerce.date(),
  expectedBackDate: z.coerce.date().nullish(),
  returned: z.boolean(),
  notes: z.string().nullish()
}).strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const authTimer = timing.start('auth')
  const { team, user } = await resolveTeamAndCheckMembership(event)
  authTimer.end()

  const body = await readValidatedBody(event, bodySchema.parse)

  // body is the validated payload (id is not part of the schema) — the database generates the id
  const dataWithoutId = body

  // Convert date string to Date object
  if (dataWithoutId.lentDate) {
    dataWithoutId.lentDate = new Date(dataWithoutId.lentDate)
  }
  // Convert date string to Date object
  if (dataWithoutId.expectedBackDate) {
    dataWithoutId.expectedBackDate = new Date(dataWithoutId.expectedBackDate)
  }
  const dbTimer = timing.start('db')
  const result = await createLendLoan({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})