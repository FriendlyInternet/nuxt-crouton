// layer: stack
/**
 * Verdict parser + deterministic floor for the BUILD reviewer (#2777, epic #2754).
 *
 * The plan reviewer (plan-verdict.mjs) judges a plan before any code. This one judges the finished,
 * green pipeline PR against its ticket before it may merge — problems that only exist after the
 * build (copies instead of moves, a loosened quality gate) which no plan review can see.
 * Persona: .claude/agents/build-reviewer.md. It writes ONE verdict file:
 *
 *   <!-- build-review:v1 -->
 *   ### Verdict
 *   go | no-go | needs-owner
 *   ### Rubric
 *   - 1: PASS|FAIL — one line of evidence        (ids 1..5)
 *   ### Question          (only for needs-owner: ONE yes/no question)
 *
 * Two layers, so a lenient model cannot wave a bad PR through:
 *  - `precheck(diff, ticket)` is DETERMINISTIC, read from `git diff -C --find-copies-harder`:
 *    item 2 fails on a file that is a copy of another (the original left behind), item 3 fails on
 *    an edit to a quality gate (`.fallow*`, lint/test config, the CI workflow) or a newly skipped
 *    test — unless the ticket names that file.
 *  - `decide(diff, ticket, verdict)` merges both: a precheck FAIL overrides the model's PASS.
 *
 *   node scripts/lib/build-verdict.mjs <diff-file> <ticket-file> <verdict-file> → JSON decision
 *   node scripts/lib/build-verdict.mjs render <diff-file> <ticket-file> <verdict-file> <round> <model>
 *   exit 1 when the verdict is malformed (the workflow then fails loudly instead of approving).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REVIEW_MARKER = '<!-- build-review:v1 -->'
export const MAX_ROUNDS = 2
export const RUBRIC = [
  { id: '1', name: 'Rule held (the diff keeps the ticket\'s rule, and a test aims at the rule itself)' },
  { id: '2', name: 'Moved, not copied (no duplicated file; anything orphaned is removed)' },
  { id: '3', name: 'Gates untouched (no edit to a quality gate\'s config or baseline, no skipped test)' },
  { id: '4', name: 'Scope (matches the ticket and plan; nothing extra)' },
  { id: '5', name: 'Plan followed (where a plan was approved, the diff does what it said)' },
]
const IDS = RUBRIC.map((r) => r.id)

/** Files that ARE a quality gate: editing one to get a PR green is a no-go by default. */
const GATE_PATTERNS = [
  /(^|\/)\.fallow[^/]*$/,
  /(^|\/)(eslint|vitest|playwright|jest)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /^\.github\/workflows\/ci\.yml$/,
]
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)tests?\//
const SKIP = /\b(?:it|test|describe)\.(?:skip|todo)\s*\(|\bx(?:it|describe)\s*\(/

const section = (body, name) => {
  const m = body.match(new RegExp(`^#{2,4}\\s+\\**\\s*${name}\\s*\\**\\s*$([\\s\\S]*?)(?=^#{2,4}\\s|(?![\\s\\S]))`, 'im'))
  return m ? m[1].trim() : ''
}

/** PURE. Parse the reviewer's verdict file. */
export function parseVerdict(body) {
  const errors = []
  if (!body.includes(REVIEW_MARKER)) errors.push(`missing marker ${REVIEW_MARKER}`)
  const stated = section(body, 'Verdict').toLowerCase().replace(/[^a-z-]/g, ' ').trim().split(/\s+/)[0] || ''
  if (!['go', 'no-go', 'needs-owner'].includes(stated)) errors.push('Verdict must be go, no-go or needs-owner')
  const items = {}
  for (const line of section(body, 'Rubric').split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s+)?\**([1-5])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
    if (m) items[m[1]] = { pass: m[2].toUpperCase() === 'PASS', evidence: m[3].replace(/\*\*/g, '').trim() }
  }
  for (const id of IDS) {
    if (!items[id]) errors.push(`rubric item ${id} missing a PASS/FAIL line`)
    else if (!items[id].evidence) errors.push(`rubric item ${id} has no evidence`)
  }
  return { ok: errors.length === 0, errors, stated, items, question: section(body, 'Question') }
}

/** PURE. Split a unified git diff into per-file facts. */
export function parseDiff(diff) {
  const files = []
  let cur = null
  for (const line of String(diff).split('\n')) {
    const h = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (h) { cur = { from: h[1], path: h[2], status: 'modified', added: [] }; files.push(cur); continue }
    if (!cur) continue
    if (line.startsWith('new file mode')) cur.status = 'added'
    else if (line.startsWith('deleted file mode')) cur.status = 'deleted'
    else if (line.startsWith('copy from ')) { cur.status = 'copied'; cur.from = line.slice(10) }
    else if (line.startsWith('rename from ')) { cur.status = 'renamed'; cur.from = line.slice(12) }
    else if (line.startsWith('+') && !line.startsWith('+++')) cur.added.push(line.slice(1))
  }
  return files
}

/** PURE. Deterministic floor from the diff alone. Returns { id: {pass:false, evidence} } for failures only. */
export function precheck(diff, ticket = '') {
  const files = parseDiff(diff)
  const fails = {}
  const copies = files.filter((f) => f.status === 'copied')
  if (copies.length) {
    fails['2'] = { pass: false, evidence: `copied, original left behind: ${copies.map((f) => `${f.from} → ${f.path}`).join('; ')}` }
  }
  const named = (p) => ticket.includes(p) || ticket.includes(p.split('/').pop())
  const gates = files.filter((f) => f.status !== 'added' && GATE_PATTERNS.some((re) => re.test(f.path)) && !named(f.path))
  const skips = files.filter((f) => TEST_FILE.test(f.path) && f.added.some((l) => SKIP.test(l)))
  const bits = []
  if (gates.length) bits.push(`quality gate edited: ${gates.map((f) => f.path).join(', ')}`)
  if (skips.length) bits.push(`test skipped/todo'd: ${skips.map((f) => f.path).join(', ')}`)
  if (bits.length) fails['3'] = { pass: false, evidence: `${bits.join('; ')} — the ticket does not ask for it` }
  return fails
}

/** PURE. Merge the deterministic floor and the reviewer's rubric into the final decision. */
export function decide(diff, ticket, verdictBody) {
  const v = parseVerdict(verdictBody)
  if (!v.ok) return { ok: false, errors: v.errors }
  const floor = precheck(diff, ticket)
  const items = {}
  for (const id of IDS) items[id] = floor[id] || v.items[id]
  const failed = IDS.filter((id) => !items[id].pass)
  const errors = []
  let verdict
  if (failed.length) verdict = 'no-go'
  else if (v.stated === 'needs-owner') verdict = 'needs-owner'
  else verdict = 'go'
  if (v.stated === 'go' && failed.length && !Object.keys(floor).length) {
    errors.push(`reviewer said go but its own rubric fails: ${failed.join(', ')}`)
  }
  if (verdict === 'needs-owner' && !v.question) errors.push('needs-owner needs a Question section')
  if (errors.length) return { ok: false, errors }
  return { ok: true, verdict, stated: v.stated, items, failed, question: v.question, overridden: Object.keys(floor) }
}

/** PURE. The typed-brief comment (plain language, depth collapsed). */
export function renderComment(d, { round = 1, model = '' } = {}) {
  const final = d.verdict === 'no-go' && round >= MAX_ROUNDS
  const lines = RUBRIC.map((r) => `- ${d.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${d.items[r.id].evidence}`).join('\n')
  const reasons = d.failed.map((id) => `- ${RUBRIC.find((r) => r.id === id).name.split(' (')[0]}: ${d.items[id].evidence}`).join('\n')
  const head = {
    go: '✅ **Build checked against its ticket** — nothing wrong found, safe to merge.\n**Next:** none.',
    'no-go': final
      ? `🔴 **Build rejected twice** — ${d.failed.length} problem(s) remain. Held for you.\n**Needs:** answer — reply with how this should change.`
      : `🔴 **Build sent back** (round ${round} of ${MAX_ROUNDS}) — ${d.failed.length} problem(s) found.\n**Worker:** fix these, then push again:\n${reasons}`,
    'needs-owner': `🔀 **Needs your call** — ${d.question}\n**Needs:** answer`,
  }[d.verdict]
  return `${REVIEW_MARKER}\n<!-- build-review-verdict:${d.verdict} -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _build review${model ? ` on \`${model}\`` : ''}_\n\n${head}\n\n<details><summary>Review checklist</summary>\n\n${lines}\n\n</details>\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const render = args[0] === 'render'
  const [diffFile, ticketFile, verdictFile, round, model] = render ? args.slice(1) : args
  if (!diffFile || !ticketFile || !verdictFile) {
    console.error('usage: build-verdict.mjs [render] <diff-file> <ticket-file> <verdict-file> [round model]')
    process.exit(2)
  }
  let d
  try { d = decide(readFileSync(diffFile, 'utf8'), readFileSync(ticketFile, 'utf8'), readFileSync(verdictFile, 'utf8')) }
  catch (e) { console.error(e.message); process.exit(1) }
  if (!d.ok) console.error(d.errors.join('\n'))
  console.log(render && d.ok ? renderComment(d, { round: Number(round) || 1, model: model || '' }) : JSON.stringify(d))
  process.exit(d.ok ? 0 : 1)
}
