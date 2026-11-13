// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { createInboxCard } from '../../../../database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { z } from 'zod'

const bodySchema = z.object({
  kind: z.string().min(1, 'kind is required'),
  sourceType: z.string().min(1, 'sourceType is required'),
  sourceNumber: z.number(),
  sourceCommentId: z.string().nullish(),
  title: z.string().min(1, 'title is required'),
  ask: z.string().min(1, 'ask is required'),
  recommendation: z.string().nullish(),
  link: z.string().min(1, 'link is required'),
  payload: z.record(z.string(), z.any()).nullish(),
  state: z.string().min(1, 'state is required'),
  answer: z.string().nullish(),
  answerNote: z.string().nullish(),
  answeredVia: z.string().nullish(),
  answerUrl: z.string().nullish(),
  askedAt: z.coerce.date(),
  answeredAt: z.coerce.date().nullish()
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
  if (dataWithoutId.askedAt) {
    dataWithoutId.askedAt = new Date(dataWithoutId.askedAt)
  }
  // Convert date string to Date object
  if (dataWithoutId.answeredAt) {
    dataWithoutId.answeredAt = new Date(dataWithoutId.answeredAt)
  }
  const dbTimer = timing.start('db')
  const result = await createInboxCard({
    ...dataWithoutId,
    teamId: team.id,
    owner: user.id,
    createdBy: user.id,
    updatedBy: user.id
  })
  dbTimer.end()
  return result
})