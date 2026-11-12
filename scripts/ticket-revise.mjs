/**
 * The ticket-review rewrite loop (#3787). PURE decisions + a small CLI; Node core only.
 *
 * Same shape as the plan-review loop (plan-verdict.mjs `route`): a ticket-review `no-go` sends the
 * failed tickets to ticket-revise.yml, which rewrites them from the review's findings and runs the
 * review again — at most 3 rounds, then it holds for the owner. A `needs-owner` verdict always holds.
 *
 * Rule: the reviser only rewrites tickets the reviewer sent back (never a `go` one), and never adds,
 * removes or changes a `Packages-approved:` / `Workflow-change:` / `Blocked-by:` / `Unblocks:` line,
 * the `<!-- pipeline: … -->` marker or the 🧪 section. `validate` is the trusted guard for that.
 *
 *   node scripts/ticket-revise.mjs route <decision.json> <comments.json> → "go|revise|hold <round>"
 *   node scripts/ticket-revise.mjs sent-back <decision.json>         → JSON array of ticket numbers
 *     (or <comments.json>: a JSON array — read from the latest rendered verdict comment instead)
 *   node scripts/ticket-revise.mjs findings <comments.json> <n>      → the ❌ lines for ticket n
 *   node scripts/ticket-revise.mjs validate <old-body> <new-body>    → exit 1 + errors if refused
 * decision.json = the output of `node scripts/lib/ticket-verdict.mjs <tickets.json> <verdict-file>`.
 * comments.json = a JSON array of epic comments `{ body, user: { login, type } }` (the GitHub API shape).
 *   Only the harness bot's own comments count (#3787 review): the repo is public, so anyone can post
 *   a comment that looks like a verdict. Same rule as scripts/lib/build-review-state.mjs.
 *
 * `--subject S` (#3846, rolling epics): `plan` or a ticket number. The round, the sent-back list and
 * the findings are then read only from the verdict comments for that subject (per plan / per ticket
 * rounds, lib/epic-steps.mjs). Blank or absent = the whole-epic behaviour above.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HARNESS_BOT, isHarnessBot, countRounds as countSubjectRounds, verdictCommentsFor } from './lib/epic-steps.mjs'

// Moved to lib/epic-steps.mjs (#3846) so lib modules can use it without an import cycle.
export { HARNESS_BOT, isHarnessBot }
export const VERDICT_MARKER = '<!-- ticket-review-verdict:'
export const MAX_ROUNDS = 3
export const NEEDS_OWNER = /^\s*needs-owner:/i
const verdictBodies = (comments) =>
  (Array.isArray(comments) ? comments : []).filter(isHarnessBot).map((c) => String(c.body || '')).filter((b) => b.includes(VERDICT_MARKER))

/**
 * PURE. The round of the verdict being posted now: the bot's verdict comments on the epic + 1.
 * With a subject (#3846): only that subject's verdict comments count (per plan / per ticket).
 */
export function countRounds(comments, subject = '') {
  return subject ? countSubjectRounds(comments, subject) : verdictBodies(comments).length + 1
}

/** PURE. What to do after a ticket review: 'go' | 'revise' | 'hold'. */
export function route(decision, round) {
  if (decision?.verdict === 'go') return 'go'
  if ((decision?.tickets || []).some((t) => t.verdict === 'needs-owner')) return 'hold'
  if (decision?.verdict !== 'no-go') return 'hold'
  return round >= MAX_ROUNDS ? 'hold' : 'revise'
}

/** PURE. The numbers of the tickets the reviewer sent back. A `go` ticket is never included. */
export function sentBack(decision) {
  return (decision?.tickets || []).filter((t) => t.verdict === 'no-go').map((t) => t.number)
}

/** PURE. Same list, read back from a rendered verdict comment (`#### ❌ #N … — no-go` headings). */
export function sentBackFromComment(body) {
  return [...String(body || '').matchAll(/^####\s+❌\s+#(\d+)\b.*—\s*no-go\s*$/gm)].map((m) => Number(m[1]))
}

/** PURE. The body of the newest harness-bot comment carrying a ticket-review verdict (for `subject`, when given), or ''. */
export function latestVerdict(comments, subject = '') {
  return (subject ? verdictCommentsFor(comments, subject) : verdictBodies(comments)).at(-1) || ''
}

/** PURE. The ❌ finding lines for ticket n from a rendered verdict comment ('' when none). */
export function findingsFor(body, n) {
  const lines = String(body || '').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^####\\s+❌\\s+#${n}\\b`).test(l))
  if (start < 0) return ''
  const out = []
  for (const l of lines.slice(start + 1)) {
    if (/^####\s/.test(l) || l.startsWith('</details>')) break
    if (/^\s*-\s+❌/.test(l)) out.push(l)
  }
  return out.join('\n')
}

// The frozen lines, compared as a sorted multiset of trimmed lines.
const linesOf = (body, re) => String(body || '').split('\n').filter((l) => re.test(l)).map((l) => l.trim()).sort()
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const FROZEN = [
  ['Packages-approved:', /^\s*Packages-approved:/i],
  ['Workflow-change:', /^\s*Workflow-change:/i],
  ['Blocked-by:', /Blocked-by:/i],
  ['Unblocks:', /^\s*Unblocks:/i],
]
const MARKER_RE = /<!--\s*pipeline:\s*[^>]*?-->/gi

/** PURE. May the reviser's new body replace the old one? → { ok, errors }. */
export function validate(oldBody, newBody) {
  const errors = []
  const next = String(newBody || '')
  if (NEEDS_OWNER.test(next)) errors.push('the reviser asks the owner (needs-owner:) — route it, never apply it')
  for (const [name, re] of FROZEN) {
    if (!same(linesOf(oldBody, re), linesOf(next, re))) errors.push(`a \`${name}\` line was added, removed or changed`)
  }
  const oldMarker = String(oldBody || '').match(MARKER_RE) || []
  const newMarker = next.match(MARKER_RE) || []
  if (!newMarker.length && oldMarker.length) errors.push('the `<!-- pipeline: … -->` marker was dropped')
  else if (!same([...oldMarker].sort(), [...newMarker].sort())) errors.push('the `<!-- pipeline: … -->` marker was changed')
  if (!/^##\s+🧪/m.test(next)) errors.push('the `## 🧪` section is missing')
  return { ok: errors.length === 0, errors }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const si = argv.indexOf('--subject')
  const subject = si >= 0 ? String(argv.splice(si, 2)[1] || '').trim() : ''
  const [mode, a, b] = argv
  const read = (f) => readFileSync(f, 'utf8')
  const usage = () => { console.error('usage: ticket-revise.mjs route <decision.json> <comments.json> | sent-back <decision.json> | findings <comments.json> <n> | validate <old> <new>'); process.exit(2) }
  if (mode === 'route' && a && b) {
    const round = countRounds(JSON.parse(read(b)), subject)
    console.log(`${route(JSON.parse(read(a)), round)} ${round}`)
  } else if (mode === 'sent-back' && a) {
    const j = JSON.parse(read(a))
    const list = Array.isArray(j) ? sentBackFromComment(latestVerdict(j, subject)) : sentBack(j)
    // A ticket subject rewrites only that ticket, even if the comment also graded others.
    console.log(JSON.stringify(/^\d+$/.test(subject) ? list.filter((n) => String(n) === subject) : list))
  } else if (mode === 'findings' && a && b) {
    console.log(findingsFor(latestVerdict(JSON.parse(read(a)), subject), Number(b)))
  } else if (mode === 'validate' && a && b) {
    const v = validate(read(a), read(b))
    if (!v.ok) { console.log(v.errors.join('\n')); process.exit(1) }
    console.log('ok')
  } else usage()
}
