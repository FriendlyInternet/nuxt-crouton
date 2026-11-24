// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createPipelineItem } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  number: z.number(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  stage: z.string().nullish(),
  labels: z.string().nullish(),
  prLabels: z.string().nullish(),
  prNumber: z.number().nullish(),
  prHeadSha: z.string().nullish(),
  prBase: z.string().nullish(),
  verdict: z.string().nullish(),
  verdictSha: z.string().nullish(),
  checksRed: z.boolean().nullish(),
  checksSha: z.string().nullish(),
  closedAt: z.coerce.date().nullish(),
  stageSince: z.coerce.date().nullish()
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
  if (dataWithoutId.closedAt) {
    dataWithoutId.closedAt = new Date(dataWithoutId.closedAt)
  }
  // Convert date string to Date object
  if (dataWithoutId.stageSince) {
    dataWithoutId.stageSince = new Date(dataWithoutId.stageSince)
  }
  const dbTimer = timing.start('db')
  const result = await createPipelineItem({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})