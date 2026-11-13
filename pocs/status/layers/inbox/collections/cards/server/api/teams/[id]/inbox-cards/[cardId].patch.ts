// Team-based endpoint - requires @fyit/crouton-auth package
// The resolveTeamAndCheckMembership utility handles team resolution and auth
import { updateInboxCard } from '../../../../database/queries'
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
}).partial().strip()

export default defineEventHandler(async (event) => {
  const timing = useServerTiming(event)

  const { cardId } = getRouterParams(event)
  if (!cardId) {
    throw createError({ status: 400, statusText: 'Missing card ID' })
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
  const result = await updateInboxCard(cardId, team.id, user.id, updates, { role: membership.role })
  dbTimer.end()
  return result
})