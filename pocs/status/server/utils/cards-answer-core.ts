// Pure core for POST /api/cards/[cardId]/answer — turn a tapped answer on an inbox card into the
// owner's GitHub reply. No Nitro auto-imports, so it unit-tests.
// Refuses every answer unless the app's token posts as the owner: the pipeline acts only on the
// owner's own comments, so a bot's `ok` would be ignored and the card would lie "answered".
import type { GhResult } from './github-core'
import { buildReply, postReply, type ParsedReply } from './reply-core'

const GH_API = 'https://api.github.com'

export const OWNER_LOGIN = 'pmcp'

export interface AnswerableCard {
  kind: string
  sourceType: string
  sourceNumber: number
  askedAt: Date | string | number
}

export interface CardAnswerInput {
  verdict?: unknown
  note?: unknown
}

export interface CardUpdates {
  state: 'answered'
  answer: string
  answerNote: string | null
  answeredVia: 'inbox'
  answerUrl: string
  answeredAt: Date
}

/** Which GitHub account the token posts as (`GET /user`). */
export async function tokenLogin(token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<GhResult<{ login: string }>> {
  if (!token) return { data: null, error: 'GITHUB_TOKEN is not configured' }
  try {
    const res = await fetchImpl(`${GH_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'crouton-status'
      }
    })
    if (!res.ok) return { data: null, error: `GitHub ${res.status}` }
    const user = (await res.json()) as { login?: unknown }
    if (typeof user.login !== 'string' || !user.login) return { data: null, error: 'GitHub /user returned no login' }
    return { data: { login: user.login }, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Map a card + tapped answer to the reply to post. v1 answers `review` cards only. */
export function buildCardReply(card: AnswerableCard, input: CardAnswerInput): GhResult<ParsedReply> {
  if (card.kind === 'review') {
    return buildReply({ kind: card.sourceType, number: card.sourceNumber, verdict: input.verdict, note: input.note })
  }
  return { data: null, error: `answers for "${card.kind}" cards are not supported yet` }
}

export interface AnswerCardArgs {
  card: AnswerableCard
  input: CardAnswerInput
  repo: string
  token: string | undefined
  fetchImpl?: typeof fetch
  now: Date
}

export interface AnswerCardResult {
  data: { url: string, existing: boolean, updates: CardUpdates | null } | null
  error: string | null
  status: number
}

/**
 * Check the token is the owner's, build the reply, post it (duplicates counted only after the
 * card was asked), and return the card updates. Any error leaves the card `waiting` (no updates).
 */
export async function answerCard({ card, input, repo, token, fetchImpl = fetch, now }: AnswerCardArgs): Promise<AnswerCardResult> {
  const who = await tokenLogin(token, fetchImpl)
  if (who.error || !who.data) return { data: null, error: who.error ?? 'GitHub unavailable', status: 502 }
  if (who.data.login !== OWNER_LOGIN) {
    return { data: null, error: `the app's GitHub token is not the owner's account (posts as ${who.data.login})`, status: 403 }
  }

  const reply = buildCardReply(card, input)
  if (reply.error || !reply.data) return { data: null, error: reply.error ?? 'Bad request', status: 400 }

  const since = new Date(card.askedAt).toISOString()
  const posted = await postReply(repo, reply.data, token, fetchImpl, { since })
  if (posted.error || !posted.data) return { data: null, error: posted.error ?? 'GitHub unavailable', status: 502 }

  if (posted.data.existing) {
    return { data: { url: posted.data.url, existing: true, updates: null }, error: null, status: 200 }
  }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const updates: CardUpdates = {
    state: 'answered',
    answer: String(input.verdict),
    answerNote: note || null,
    answeredVia: 'inbox',
    answerUrl: posted.data.url,
    answeredAt: now
  }
  return { data: { url: posted.data.url, existing: false, updates }, error: null, status: 200 }
}
