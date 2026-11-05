// Pure helper for POST /api/walk-result — turn a finished walk into the epic's `ok` / `not ok: …` reply.
// No Nitro auto-imports, so it unit-tests.
import type { GhResult } from './github-core'
import type { ParsedReply } from './reply-core'

export interface WalkResultInput {
  /** The walk's `ref` — the epic number as `#123` (or `123`). Empty ⇒ nothing is posted. */
  ref?: unknown
  /** Per-step verdicts the walk collected. */
  steps?: unknown
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/**
 * All steps "works" → `ok`; any "issue" → `not ok: <step> — <note>` with one line per issue.
 * Returns `data: null, error: null` when the walk has no `ref` (nothing to post, not a failure).
 */
export function buildWalkReply(input: WalkResultInput): GhResult<ParsedReply> {
  const ref = typeof input.ref === 'string' ? input.ref.trim() : ''
  if (!ref) return { data: null, error: null }
  const m = /^#?(\d+)$/.exec(ref)
  const number = m ? Number(m[1]) : 0
  if (!number) return { data: null, error: 'ref must be an issue number like "#123"' }
  if (!Array.isArray(input.steps) || !input.steps.length) return { data: null, error: 'steps must be a non-empty list' }

  const issues: string[] = []
  for (const s of input.steps as Array<Record<string, unknown>>) {
    if (s?.verdict === 'issue') {
      const text = clip(s.text, 120) || 'step'
      const note = clip(s.note, 300)
      issues.push(note ? `${text} — ${note}` : text)
    } else if (s?.verdict !== 'works') {
      return { data: null, error: 'every step needs a "works" or "issue" verdict before sending' }
    }
  }
  const body = issues.length ? `not ok: ${issues.join('\n')}` : 'ok'
  return { data: { kind: 'issue', number, body }, error: null }
}
