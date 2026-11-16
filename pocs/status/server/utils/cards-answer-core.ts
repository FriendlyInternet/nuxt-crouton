// Pure core for POST /api/cards/[cardId]/answer — turn a tapped answer on an inbox card into the
// owner's GitHub reply. No Nitro auto-imports, so it unit-tests.
// Refuses every answer unless the app's token posts as the owner: the pipeline acts only on the
// owner's own comments, so a bot's `ok` would be ignored and the card would lie "answered".
import type { GhResult } from './github-core'
import { buildReply, postReply, type ParsedReply } from './reply-core'
import { parseAnswers, quizStatements } from '../../app/utils/quiz-core'

const GH_API = 'https://api.github.com'

export const OWNER_LOGIN = 'pmcp'

export interface AnswerableCard {
  kind: string
  sourceType: string
  sourceNumber: number
  askedAt: Date | string | number
  payload?: Record<string, unknown> | null
}

export interface CardAnswerInput {
  verdict?: unknown
  note?: unknown
  /** Quiz cards only: the `1B 2A 3C` answer line. */
  answer?: unknown
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

/**
 * Map a card + tapped answer to the reply to post. Answers `review` cards (ok / not-ok) and
 * `delivery` cards (works / not-ok — Works posts `ok` on the epic, like a review ok), and `quiz`
 * cards (the `1B 2A 3C` line, checked with the quiz's own parser; `verdict` is ignored, so a quiz
 * never posts `ok`).
 */
export function buildCardReply(card: AnswerableCard, input: CardAnswerInput): GhResult<ParsedReply> {
  if (card.kind === 'review') {
    return buildReply({ kind: card.sourceType, number: card.sourceNumber, verdict: input.verdict, note: input.note })
  }
  if (card.kind === 'delivery') {
    if (input.verdict !== 'works' && input.verdict !== 'not-ok') return { data: null, error: 'verdict must be "works" or "not-ok"' }
    const verdict = input.verdict === 'works' ? 'ok' : 'not-ok'
    return buildReply({ kind: card.sourceType, number: card.sourceNumber, verdict, note: input.note })
  }
  if (card.kind === 'quiz') return buildQuizReply(card, input)
  return { data: null, error: `answers for "${card.kind}" cards are not supported yet` }
}

function buildQuizReply(card: AnswerableCard, input: CardAnswerInput): GhResult<ParsedReply> {
  const kind = card.sourceType
  if (kind !== 'issue' && kind !== 'pr') return { data: null, error: 'kind must be "issue" or "pr"' }
  const number = Number(card.sourceNumber)
  if (!Number.isInteger(number) || number <= 0) return { data: null, error: 'number must be a positive integer' }
  const n = quizStatements(card.payload).length
  if (n === 0) return { data: null, error: 'quiz card has no questions' }
  const line = typeof input.answer === 'string' ? input.answer.trim() : ''
  const parsed = parseAnswers(line, n)
  if (parsed.error || !parsed.answers) return { data: null, error: `not a quiz answer: ${parsed.error ?? 'unreadable'}` }
  const answers = parsed.answers
  const body = Array.from({ length: n }, (_, i) => `${i + 1}${answers[i + 1]}`).join(' ')
  return { data: { kind, number, body }, error: null }
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
    answer: card.kind === 'quiz' ? reply.data.body : String(input.verdict),
    answerNote: note || null,
    answeredVia: 'inbox',
    answerUrl: posted.data.url,
    answeredAt: now
  }
  return { data: { url: posted.data.url, existing: false, updates }, error: null, status: 200 }
}
