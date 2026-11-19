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
 *   - 1: PASS|FAIL — one line of evidence        (ids 1..7)
 *   ### Question          (only for needs-owner: ONE yes/no question)
 *   ### Outside review    (only when the outside reviewer has High findings, #4318)
 *   - Q1: fixed in <commit> — … | - Q1: not a problem because …
 *
 * Two layers, so a lenient model cannot wave a bad PR through:
 *  - `precheck(diff, ticket)` is DETERMINISTIC, read from `git diff -C --find-copies-harder`:
 *    item 2 fails on a copy whose original is left behind (source named in the ticket or in a package the diff also edits)
 *    — except a copy into a scope the diff creates from an untouched scope (#4143); item 3 fails on
 *    an edit to a quality gate (`.fallow*`, lint/test config, the CI workflow) or a newly skipped
 *    test — unless the ticket names that file. A copied (new) file is not a gate edit (#4143). Exemptions (#3550): a workflow file when the ticket
 *    says `Workflow-change: yes`; a copied drizzle `meta/NNNN_snapshot.json`; skip-like text inside a
 *    same-line string literal.
 *  - `decide(diff, ticket, verdict, outside)` merges both: a precheck FAIL overrides the model's PASS.
 *    `outside` is scripts/lib/outside-review.mjs's state: a go (or needs-owner) that leaves a High
 *    finding of an answered outside review without an answer is rewritten to no-go (#4318).
 *
 *   node scripts/lib/build-verdict.mjs <diff-file> <ticket-file> <verdict-file> → JSON decision
 *   (both modes take an optional `--outside <outside.json>` anywhere in argv)
 *   node scripts/lib/build-verdict.mjs render <diff-file> <ticket-file> <verdict-file> <round> <model>
 *   node scripts/lib/build-verdict.mjs stop-line <log-file>   → " — it stopped at: `<line>`" (#3696)
 *   exit 1 when the verdict is malformed (the workflow then fails loudly instead of approving).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OUTSIDE_REVIEW_WAIT_MIN } from './outside-review.mjs'

export const REVIEW_MARKER = '<!-- build-review:v1 -->'
export const MAX_ROUNDS = 2
export const FINAL_MARKER = '<!-- build-review-final -->'
export const RUBRIC = [
  { id: '1', name: 'Rule held (the diff keeps the ticket\'s rule, and a test aims at the rule itself)' },
  { id: '2', name: 'Moved, not copied (no duplicated file; anything orphaned is removed)' },
  { id: '3', name: 'Gates untouched (no edit to a quality gate\'s config or baseline, no skipped test)' },
  { id: '4', name: 'Scope (matches the ticket and plan; nothing extra)' },
  { id: '5', name: 'Plan followed (where a plan was approved, the diff does what it said)' },
  { id: '6', name: 'Every ticket step done (each numbered step and acceptance line is done, or dropped with the reason stated in the PR)' },
  { id: '7', name: 'Docs (the CLAUDE.md "Maintaining AI Documentation" row is followed, and every doc edit the plan\'s Docs section names is made or marked as debt)' },
]
const IDS = RUBRIC.map((r) => r.id)
export const OUTSIDE = { id: 'outside', name: 'Outside review answered (each High finding: fixed in <commit>, or not a problem because …)' }
const ITEMS = [...RUBRIC, OUTSIDE]
const NO_OUTSIDE = { state: 'none', high: [] }
// One answer per High finding (#4318): `- Q<n>: fixed in <7-40 hex>` or `- Q<n>: not a problem because <reason>`.
const ANSWER = /^\s*[-*]\s+\**(Q\d+)\**\s*[:.)]\s*((?:fixed in\s+[0-9a-f]{7,40}\b|not a problem because\s+\S)[\s\S]*)$/i

/** Files that ARE a quality gate: editing one to get a PR green is a no-go by default. */
const GATE_PATTERNS = [
  /(^|\/)\.fallow[^/]*$/,
  /(^|\/)(eslint|vitest|playwright|jest)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /^\.github\/workflows\/ci\.yml$/,
]
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)tests?\//
const WORKFLOW_CHANGE = /\bWorkflow-change:\s*\**\s*yes\b/i
const WORKFLOW_FILE = /^\.github\/workflows\//
const MIGRATION_SNAPSHOT = /\/migrations\/.*\/meta\/\d+_snapshot\.json$/
// Drop same-line string literals so skip-like text in test data is not read as a skipped test.
const stripStrings = (l) => l.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""')
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
    const m = line.match(/^\s*(?:[-*]\s+)?\**([1-7])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
    if (m) items[m[1]] = { pass: m[2].toUpperCase() === 'PASS', evidence: m[3].replace(/\*\*/g, '').trim() }
  }
  for (const id of IDS) {
    if (!items[id]) errors.push(`rubric item ${id} missing a PASS/FAIL line`)
    else if (!items[id].evidence) errors.push(`rubric item ${id} has no evidence`)
  }
  const answers = {}
  for (const line of section(body, 'Outside review').split('\n')) {
    const m = line.match(ANSWER)
    if (m) answers[m[1].toUpperCase()] = m[2].replace(/\*\*/g, '').trim()
  }
  return { ok: errors.length === 0, errors, stated, items, answers, question: section(body, 'Question') }
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
  // --find-copies-harder reports a copy of ANY tracked file, so a copy only means "original left
  // behind" when its source is named in the ticket or sits in a package the diff also edits (#3160).
  // #4143: a copy's destination is always a new file, so it is never a gate edit; and a copy into a
  // scope the diff CREATES (its own package.json new, every file in it new) from an untouched scope
  // is a scaffold mirroring a starter file, not a move.
  const isNew = (f) => f.status === 'added' || f.status === 'copied'
  const scopeOf = (p) => {
    const seg = p.split('/')
    if (['packages', 'apps', 'pocs'].includes(seg[0]) && seg.length > 2) return `${seg[0]}/${seg[1]}`
    if (['scripts', '.github'].includes(seg[0])) return seg[0]
    return null
  }
  const touched = new Set(files.filter((f) => !isNew(f)).map((f) => scopeOf(f.from)).filter(Boolean))
  const created = new Set(files
    .filter((f) => isNew(f) && scopeOf(f.path) && f.path === `${scopeOf(f.path)}/package.json`)
    .map((f) => scopeOf(f.path))
    .filter((s) => files.every((f) => scopeOf(f.path) !== s || isNew(f))))
  const scaffold = (f) => created.has(scopeOf(f.path)) && scopeOf(f.from) !== scopeOf(f.path) && !touched.has(scopeOf(f.from))
  const copies = files.filter((f) => f.status === 'copied' && !MIGRATION_SNAPSHOT.test(f.path) && !scaffold(f) && (ticket.includes(f.from) || touched.has(scopeOf(f.from))))
  if (copies.length) {
    fails['2'] = { pass: false, evidence: `copied, original left behind: ${copies.map((f) => `${f.from} → ${f.path}`).join('; ')}` }
  }
  const named = (p) => ticket.includes(p) || ticket.includes(p.split('/').pop())
  const gates = files.filter((f) => !isNew(f) && GATE_PATTERNS.some((re) => re.test(f.path)) && !named(f.path) && !(WORKFLOW_FILE.test(f.path) && WORKFLOW_CHANGE.test(ticket)))
  const skips = files.filter((f) => TEST_FILE.test(f.path) && f.added.some((l) => SKIP.test(stripStrings(l))))
  const bits = []
  if (gates.length) bits.push(`quality gate edited: ${gates.map((f) => f.path).join(', ')}`)
  if (skips.length) bits.push(`test skipped/todo'd: ${skips.map((f) => f.path).join(', ')}`)
  if (bits.length) fails['3'] = { pass: false, evidence: `${bits.join('; ')} — the ticket does not ask for it` }
  return fails
}

const unansweredText = (h) => `no answer to ${h.id} "${h.title}"${h.file ? ` (${h.file})` : ''}`

/** PURE. Match the outside review's High findings to the verdict's answers (#4318). */
export function outsideAnswers(outside, given = {}) {
  const o = outside || NO_OUTSIDE
  const high = o.state === 'answered' ? (o.high || []) : []
  const answers = Object.fromEntries(high.filter((h) => given[h.id]).map((h) => [h.id, given[h.id]]))
  const unanswered = high.filter((h) => !answers[h.id])
  return { state: o.state || 'none', late: !!o.late, high, answers, unanswered, sha: o.sha || '' }
}

/** PURE. Merge the deterministic floor and the reviewer's rubric into the final decision. */
export function decide(diff, ticket, verdictBody, outside = NO_OUTSIDE) {
  const v = parseVerdict(verdictBody)
  if (!v.ok) return { ok: false, errors: v.errors }
  const floor = precheck(diff, ticket)
  const items = {}
  for (const id of IDS) items[id] = floor[id] || v.items[id]
  const failed = IDS.filter((id) => !items[id].pass)
  const errors = []
  if (v.stated === 'go' && failed.length && !Object.keys(floor).length) {
    errors.push(`reviewer said go but its own rubric fails: ${failed.join(', ')}`)
  }
  const seen = outsideAnswers(outside, v.answers)
  if (seen.unanswered.length) {
    items.outside = { pass: false, evidence: seen.unanswered.map(unansweredText).join('; ') }
    failed.push(OUTSIDE.id)
  }
  let verdict
  if (failed.length) verdict = 'no-go'
  else if (v.stated === 'needs-owner') verdict = 'needs-owner'
  else verdict = 'go'
  if (verdict === 'needs-owner' && !v.question) errors.push('needs-owner needs a Question section')
  if (errors.length) return { ok: false, errors }
  return { ok: true, verdict, stated: v.stated, items, failed, question: v.question, overridden: Object.keys(floor), outside: seen }
}

/** PURE. The one visible "Outside review" line (+ the seen-marker the merge check reads, #4318). */
export function outsideLine(o = NO_OUTSIDE) {
  const n = (o.high || []).length
  const text = {
    none: 'no outside review on this PR',
    paused: 'no outside review on this PR (the outside reviewer is paused)',
    asked: o.late ? `the outside reviewer did not answer (asked over ${OUTSIDE_REVIEW_WAIT_MIN} min ago)` : 'asked, no answer yet',
    answered: !n ? 'no High findings'
      : (o.unanswered || []).length ? `${n} High finding(s), ${o.unanswered.length} without an answer`
        : `${n} High finding(s), all answered`,
  }[o.state] || 'no outside review on this PR'
  return `**Outside review:** ${text}${o.sha ? ` <!-- outside-review-seen:${o.state}:${o.sha} -->` : ''}`
}

/** PURE. The typed-brief comment (plain language, depth collapsed). */
export function renderComment(d, { round = 1, model = '', okAgain = '' } = {}) {
  const final = d.verdict === 'no-go' && round >= MAX_ROUNDS
  const o = d.outside || NO_OUTSIDE
  const answered = Object.entries(o.answers || {}).map(([id, a]) => `- ✅ **${id}** — ${a}`)
  const lines = [
    ...ITEMS.filter((r) => d.items[r.id]).map((r) => `- ${d.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${d.items[r.id].evidence}`),
    ...(answered.length ? ['', 'Outside review answers:', ...answered] : []),
  ].join('\n')
  const reasons = d.failed.map((id) => `- ${ITEMS.find((r) => r.id === id).name.split(' (')[0]}: ${d.items[id].evidence}`).join('\n')
  const head = {
    go: '✅ **Build checked against its ticket** — nothing wrong found, safe to merge.\n**Next:** none.',
    'no-go': final
      ? `🔴 **Build rejected twice** — ${d.failed.length} problem(s) remain. Held for you.\n**Needs:** answer — reply \`ok\` to merge as is, or reply with how this should change.${okAgain ? `\n${okAgain}` : ''}`
      : `🔴 **Build sent back** (round ${round} of ${MAX_ROUNDS}) — ${d.failed.length} problem(s) found.\n**Worker:** fix these, then push again:\n${reasons}`,
    'needs-owner': `🔀 **Needs your call** — ${d.question}\n**Needs:** answer — reply \`ok\` to merge as is, or reply with how this should change.`,
  }[d.verdict]
  return `${REVIEW_MARKER}\n${final ? `${FINAL_MARKER}\n` : ''}<!-- build-review-verdict:${d.verdict} -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _build review${model ? ` on \`${model}\`` : ''}_\n\n${head}\n${outsideLine(o)}\n\n<details><summary>Review checklist</summary>\n\n${lines}\n\n</details>\n`
}

/**
 * #3696 — the one line of pi's log that says why it stopped, so "produced no verdict" names the cause.
 * Prefers the last line that STARTS with `Error`/`fatal` (pi's own message) over a later runner
 * `##[error]` line, then any line with an error word, then the last non-empty line, else ''.
 * ANSI codes stripped, backticks swapped for `'`, capped at 300 chars.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

export function stopLine(log) {
  const lines = String(log ?? '')
    .replace(ANSI, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const last = (re) => [...lines].reverse().find((l) => re.test(l))
  const line = last(/^(Error|fatal)\b[:!]?/) ?? last(/\b(Error|error|fatal)\b[:!]?/) ?? lines.at(-1) ?? ''
  return line.replace(/`/g, "'").slice(0, 300)
}

export function stopLineSuffix(logFile) {
  let log = ''
  try { log = readFileSync(logFile, 'utf8') } catch { log = '' }
  const line = stopLine(log)
  return line ? ` — it stopped at: \`${line}\`` : ' — pi printed nothing'
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'stop-line') {
  process.stdout.write(stopLineSuffix(process.argv[3]))
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const oi = args.indexOf('--outside')
  const outsideFile = oi >= 0 ? args.splice(oi, 2)[1] : ''
  let outside = NO_OUTSIDE
  if (outsideFile) {
    try { outside = JSON.parse(readFileSync(outsideFile, 'utf8')) } catch (e) { console.error(`--outside unreadable, treated as none: ${e.message}`) }
  }
  const render = args[0] === 'render'
  const [diffFile, ticketFile, verdictFile, round, model, okAgain] = render ? args.slice(1) : args
  if (!diffFile || !ticketFile || !verdictFile) {
    console.error('usage: build-verdict.mjs [render] <diff-file> <ticket-file> <verdict-file> [round model]')
    process.exit(2)
  }
  let d
  try { d = decide(readFileSync(diffFile, 'utf8'), readFileSync(ticketFile, 'utf8'), readFileSync(verdictFile, 'utf8'), outside) }
  catch (e) { console.error(e.message); process.exit(1) }
  if (!d.ok) console.error(d.errors.join('\n'))
  console.log(render && d.ok ? renderComment(d, { round: Number(round) || 1, model: model || '', okAgain: okAgain || '' }) : JSON.stringify(d))
  process.exit(d.ok ? 0 : 1)
}
