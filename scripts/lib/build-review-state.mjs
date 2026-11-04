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

const stateOf = (c) => {
  const body = c.body || ''
  const failed = body.match(FAILED_RE)
  const sha = body.match(SHA_RE)
  return { sha: failed?.[1] || sha?.[1], failed: Boolean(failed && !sha) }
}

const isFinal = (body) => body.includes(FINAL_MARKER) || firstHeading(body).startsWith('🔴 **Build rejected twice**')

const kindOf = (c, failed) => {
  if (failed) return 'failed'
  const body = c.body || ''
  if (body.match(VERDICT_RE)?.[1] !== 'no-go') return 'other'
  return isFinal(body) ? 'final' : 'round1'
}

/** @returns {{kind: 'final'|'round1'|'failed'|'other'|'pending', at?: string}} */
export function reviewState({ comments = [], headSha, bots = [] }) {
  const mine = comments
    .filter(c => isReviewerBot(c, bots))
    .map(c => ({ c, ...stateOf(c) }))
    .filter(x => x.sha && x.sha === headSha)
  if (!mine.length) return { kind: 'pending' }
  // Latest wins; on equal timestamps the later comment in the list wins.
  const best = mine.reduce((a, b) => (new Date(b.c.created_at) < new Date(a.c.created_at) ? a : b))
  return { kind: kindOf(best.c, best.failed), at: best.c.created_at }
}
