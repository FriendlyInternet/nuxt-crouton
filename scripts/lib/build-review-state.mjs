// build-review-state.mjs — what did the build reviewer last say about THIS head commit? (#3173)
//
// Pure. Reads only the reviewer bot's own comments (user.type === 'Bot' and login in `bots`), so a
// human quoting a marker cannot forge a state. State is per commit SHA, never per comment date.
//
//   final   — rejected twice, held for the owner
//   round1  — rejected once, sent back to the worker
//   failed  — the review itself failed to run
//   other   — go / needs-owner
//   pending — no state comment for this SHA yet
export const FINAL_MARKER = '<!-- build-review-final -->'
const SHA_RE = /<!-- build-review-sha:([0-9a-f]+) -->/
const FAILED_RE = /<!-- build-review-failed-sha:([0-9a-f]+) -->/
const VERDICT_RE = /<!-- build-review-verdict:([a-z-]+) -->/

const isReviewerBot = (c, bots) =>
  c.user?.type === 'Bot' && bots.some(b => String(b).toLowerCase() === String(c.user?.login).toLowerCase())

// First visible line: skip HTML comments, blockquotes and blanks (legacy holds had no final marker).
const firstHeading = (body) => String(body).replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.trim()).find(l => l && !l.startsWith('>')) || ''

/** @returns {{kind: 'final'|'round1'|'failed'|'other'|'pending', at?: string}} */
export function reviewState({ comments = [], headSha, bots = [] }) {
  let best = null
  for (const c of comments) {
    if (!isReviewerBot(c, bots)) continue
    const body = c.body || ''
    const failed = body.match(FAILED_RE)
    const sha = body.match(SHA_RE)
    const marked = failed?.[1] || sha?.[1]
    if (!marked || marked !== headSha) continue
    if (best && new Date(c.created_at) < new Date(best.c.created_at)) continue
    best = { c, failed: Boolean(failed && !sha) }
  }
  if (!best) return { kind: 'pending' }
  const { c, failed } = best
  const at = c.created_at
  if (failed) return { kind: 'failed', at }
  const body = c.body || ''
  const verdict = body.match(VERDICT_RE)?.[1]
  if (verdict === 'no-go') {
    const final = body.includes(FINAL_MARKER) || firstHeading(body).startsWith('🔴 **Build rejected twice**')
    return { kind: final ? 'final' : 'round1', at }
  }
  return { kind: 'other', at }
}
