// POST /api/cards/[cardId]/answer — answer an inbox card by posting the owner's reply on GitHub.
// Body: { verdict: 'ok'|'not-ok', note? } → { data: { url, existing }, error }
// The param is `cardId`, never `id` — crouton reads `id` as the team. Refused unless the app's
// token posts as the owner (see GET /api/cards/token-account). On any error the card stays `waiting`.
import { getInboxCardsByIds, updateInboxCard } from '../../../../layers/inbox/collections/cards/server/database/queries'
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { answerCard } from '../../../utils/cards-answer-core'
import { githubToken, requireStatusOwner } from '../../../utils/github'

const REPO = 'FriendlyInternet/nuxt-crouton'

export default defineEventHandler(async (event) => {
  await requireStatusOwner(event)
  const { team, user, membership } = await resolveTeamAndCheckMembership(event)

  const cardId = getRouterParam(event, 'cardId')
  if (!cardId) throw createError({ statusCode: 400, statusMessage: 'Missing card ID' })

  const [card] = await getInboxCardsByIds(team.id, [cardId])
  if (!card) throw createError({ statusCode: 404, statusMessage: 'Card not found' })

  const body = (await readBody(event).catch(() => ({}))) ?? {}
  const result = await answerCard({
    card,
    input: { verdict: body.verdict, note: body.note },
    repo: REPO,
    token: githubToken(event),
    now: new Date()
  })
  if (result.error || !result.data) throw createError({ statusCode: result.status, statusMessage: result.error ?? 'Answer failed' })

  if (result.data.updates) {
    // answerNote may be null (clears the column); the generated read type is deliberately narrower.
    const updates = result.data.updates as unknown as Parameters<typeof updateInboxCard>[3]
    await updateInboxCard(cardId, team.id, user.id, updates, { role: membership.role })
  }

  return { data: { url: result.data.url, existing: result.data.existing }, error: null }
})
