// Pure core for the quiz card: payload → statements, taps → the `1B 2A 3C` answer line the quiz
// reads. No refs, no $fetch, no auto-imports, so it unit-tests (and the server imports it too).
// isQuizReply / replyKind / parseAnswers are a copy of scripts/owner-quiz.mjs — keep in step.

export interface QuizStatement {
  statement: string
  choices: [string, string, string]
}

export const PICKS = ['A', 'B', 'C', '?'] as const
export type QuizPick = typeof PICKS[number]

/**
 * The statements of a quiz card, read from `payload.questions`. Each entry is rebuilt with only
 * `statement` and its three `choices`, so nothing else in the payload (an answer key) is carried.
 */
export function quizStatements(payload: unknown): QuizStatement[] {
  const questions = (payload as { questions?: unknown } | null | undefined)?.questions
  if (!Array.isArray(questions)) return []
  const out: QuizStatement[] = []
  for (const q of questions) {
    const statement = (q as { statement?: unknown } | null)?.statement
    const choices = (q as { choices?: unknown } | null)?.choices
    if (typeof statement !== 'string' || !statement.trim()) continue
    if (!Array.isArray(choices) || choices.length !== 3) continue
    const [a, b, c] = choices as unknown[]
    if (typeof a !== 'string' || typeof b !== 'string' || typeof c !== 'string') continue
    out.push({ statement, choices: [a, b, c] })
  }
  return out
}

const isPick = (v: unknown): v is QuizPick => (PICKS as readonly unknown[]).includes(v)

/** True only when every statement 1..n has a pick (A, B, C or ?). */
export function canSend(statements: readonly QuizStatement[], picks: Readonly<Record<number, QuizPick | undefined>>): boolean {
  if (!statements.length) return false
  return statements.every((_, i) => isPick(picks[i + 1]))
}

/** The answer line (`1B 2? 3C`), or null until every statement has a pick. */
export function answerLine(statements: readonly QuizStatement[], picks: Readonly<Record<number, QuizPick | undefined>>): string | null {
  if (!canSend(statements, picks)) return null
  return statements.map((_, i) => `${i + 1}${picks[i + 1]}`).join(' ')
}

// ------------------------------------------------ copy of scripts/owner-quiz.mjs (keep in step)

const CAUSES = ['docs', 'code', 'intent']
const TOKEN = /(\d+)\s*(docs|code|intent|[abc?])/gi

function tokens(body: string) {
  return [...String(body).matchAll(TOKEN)].map(m => ({ q: Number(m[1]), v: m[2]!.toLowerCase() }))
}

/** A comment made ONLY of answer tokens (`1B 2a 3?`) or triage tokens (`2 code`). `ok` never matches. */
export function isQuizReply(body = ''): boolean {
  const s = String(body).trim()
  if (!s || !/\d/.test(s)) return false
  return s.replace(TOKEN, '').replace(/[\s,;.]/g, '') === '' && tokens(s).length > 0
}

/** 'answers' | 'triage' | 'mixed' for a quiz-shaped reply. */
export function replyKind(body = ''): 'answers' | 'triage' | 'mixed' {
  const t = tokens(body)
  const tri = t.filter(x => CAUSES.includes(x.v)).length
  if (tri === 0) return 'answers'
  return tri === t.length ? 'triage' : 'mixed'
}

/** One A/B/C/? per question 1..n, nothing else. */
export function parseAnswers(body: string, n: number): { answers?: Record<number, string>, error?: string } {
  if (!isQuizReply(body) || replyKind(body) !== 'answers') return { error: 'not an answer line' }
  const answers: Record<number, string> = {}
  for (const { q, v } of tokens(body)) {
    if (q < 1 || q > n) return { error: `there is no question ${q}` }
    if (answers[q]) return { error: `question ${q} answered twice` }
    answers[q] = v === '?' ? '?' : v.toUpperCase()
  }
  const missing = Array.from({ length: n }, (_, i) => i + 1).filter(q => !answers[q])
  if (missing.length) return { error: `no answer for question ${missing.join(', ')}` }
  return { answers }
}
