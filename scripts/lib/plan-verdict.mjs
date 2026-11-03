/**
 * Verdict parser + rubric for the independent plan reviewer (#2756, epic #2754).
 *
 * The reviewer (persona .claude/agents/plan-reviewer.md) reads a plan comment (see plan-shape.mjs)
 * and writes ONE verdict file:
 *
 *   <!-- plan-review:v1 -->
 *   ### Verdict
 *   go | no-go | needs-owner
 *   ### Rubric
 *   - 1: PASS|FAIL — one line of evidence        (ids: 1 1b 2 3 4 5 6 7 8 9)
 *   ### Question          (only for needs-owner: ONE yes/no question)
 *
 * Items 8 (rule stated and tested) and 9 (contradicts the record) are judged by the reviewer alone.
 * Item 7 is "no owner decision needed": PASS = none needed, FAIL = the owner must decide.
 *
 * Two layers, so a lenient model cannot wave a bad plan through:
 *  - `precheck(plan)` is DETERMINISTIC — it fails items 1, 1b, 2, 3 straight from the plan's own
 *    text (not reproduced, unlinked evidence, hedging words in Cause, unverified assumptions).
 *  - `decide(plan, verdict)` merges both: any precheck FAIL overrides the model's PASS, and the
 *    stated verdict must agree with the rubric (a `go` with a FAIL is rejected, not trusted).
 *
 *   node scripts/lib/plan-verdict.mjs <plan-file> <verdict-file> → JSON decision, exit 1 if the
 *   verdict is malformed (the workflow then fails loudly instead of approving).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePlan } from './plan-shape.mjs'

export const REVIEW_MARKER = '<!-- plan-review:v1 -->'
/** Added to the second no-go of a round ("held for you"); plan-held.mjs reads it. */
export const HELD_MARKER = '<!-- plan-review-held -->'
export const RUBRIC = [
  { id: '1', name: 'Reproduced? (observed, not reasoned)' },
  { id: '1b', name: 'Every assumption has a reason and a working evidence link' },
  { id: '2', name: 'Cause proven? (evidence ties symptom to cause)' },
  { id: '3', name: 'No unverified assumptions' },
  { id: '4', name: 'Smallest change (no over-engineering)' },
  { id: '5', name: 'Best practice, no hacks' },
  { id: '6', name: 'Scope matches the issue' },
  { id: '7', name: 'No owner decision needed' },
  { id: '8', name: 'Rule stated and tested? (a test aims at the rule, not only the mechanism)' },
  { id: '9', name: 'Contradicts the record? (no step conflicts with the epic Decisions log, experiments or merged findings)' },
]
const IDS = RUBRIC.map((r) => r.id)
const HEDGE = /\b(should|probably|likely|presumably|might|i think|seems? to)\b/i

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
    const m = line.match(/^\s*(?:[-*]\s+)?\**(1b|[1-9])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
    if (m) items[m[1].toLowerCase()] = { pass: m[2].toUpperCase() === 'PASS', evidence: m[3].replace(/\*\*/g, '').trim() }
  }
  for (const id of IDS) {
    if (!items[id]) errors.push(`rubric item ${id} missing a PASS/FAIL line`)
    else if (!items[id].evidence) errors.push(`rubric item ${id} has no evidence`)
  }
  const question = section(body, 'Question')
  return { ok: errors.length === 0, errors, stated, items, question }
}

/** PURE. Deterministic floor from the plan text alone. Returns { id: {pass, evidence} } for failures only. */
export function precheck(planBody) {
  const plan = parsePlan(planBody)
  const fails = {}
  const cause = section(planBody, 'Cause')
  const reproErr = plan.errors.find((e) => /^Reproduced/.test(e))
  if (reproErr) fails['1'] = { pass: false, evidence: reproErr }
  else if (plan.reproduced === false) fails['1'] = { pass: false, evidence: 'Plan says Reproduced: no — observed, not reasoned is required' }
  const asmErr = plan.errors.filter((e) => /^assumption \d+/.test(e))
  if (asmErr.length) fails['1b'] = { pass: false, evidence: asmErr.join('; ') }
  const hedge = cause.match(HEDGE)
  if (!cause) fails['2'] = { pass: false, evidence: 'Cause section is missing or empty' }
  else if (hedge) fails['2'] = { pass: false, evidence: `Cause is stated without a check ("${hedge[0]}")` }
  const unverified = plan.assumptions.filter((a) => a.status === 'unverified')
  if (unverified.length) fails['3'] = { pass: false, evidence: `plan relies on ${unverified.length} unverified assumption(s): ${unverified.map((a) => a.claim).join('; ')}` }
  const shapeErr = plan.errors.filter((e) => !/^Reproduced/.test(e) && !/^assumption \d+/.test(e))
  if (shapeErr.length) fails['1'] ||= { pass: false, evidence: `plan is malformed: ${shapeErr.join('; ')}` }
  return fails
}

/** PURE. Merge the deterministic floor and the reviewer's rubric into the final decision. */
export function decide(planBody, verdictBody) {
  const v = parseVerdict(verdictBody)
  if (!v.ok) return { ok: false, errors: v.errors }
  const floor = precheck(planBody)
  const items = {}
  for (const id of IDS) items[id] = floor[id] || v.items[id]
  const failed = IDS.filter((id) => !items[id].pass)
  const hardFails = failed.filter((id) => id !== '7')
  const errors = []
  let verdict
  if (hardFails.length) verdict = 'no-go'
  else if (!items['7'].pass) verdict = 'needs-owner'
  else verdict = 'go'
  if (v.stated === 'go' && verdict !== 'go' && !Object.keys(floor).length) {
    errors.push(`reviewer said go but its own rubric fails: ${failed.join(', ')}`)
  }
  if (verdict === 'needs-owner' && !v.question) errors.push('needs-owner needs a Question section')
  if (errors.length) return { ok: false, errors }
  return { ok: true, verdict, stated: v.stated, items, failed, question: v.question, overridden: Object.keys(floor) }
}

/** PURE. The typed-brief comment (plain language, depth collapsed). */
export function renderComment(d, { round = 1, maxRounds = 2, model = '' } = {}) {
  const final = d.verdict === 'no-go' && round >= maxRounds
  const lines = RUBRIC.map((r) => `- ${d.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${d.items[r.id].evidence}`).join('\n')
  const head = {
    go: '✅ **Plan approved** — safe to build from it.\n**Next:** none, the build can start.',
    'no-go': final
      ? `🔴 **Plan rejected twice** — the planner could not fix ${d.failed.filter((i) => i !== '7').length} check(s). Held for you.\n**Needs:** answer — reply with guidance on how the plan should change.`
      : `🔴 **Plan sent back** (round ${round} of ${maxRounds}) — ${d.failed.filter((i) => i !== '7').length} check(s) failed. The planner is re-run with these reasons.`,
    'needs-owner': `🔀 **Needs your call** — ${d.question}\n**Needs:** answer`,
  }[d.verdict]
  return `${REVIEW_MARKER}\n<!-- plan-review-verdict:${d.verdict} -->\n${final ? `${HELD_MARKER}\n` : ''}> 🤖 **pi.dev harness** · agent pipeline (CI) · _plan review${model ? ` on \`${model}\`` : ''}_\n\n${head}\n\n<details><summary>Review checklist</summary>\n\n${lines}\n\n</details>\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const render = args[0] === 'render'
  const [planFile, verdictFile, round, model] = render ? args.slice(1) : args
  if (!planFile || !verdictFile) { console.error('usage: plan-verdict.mjs [render] <plan-file> <verdict-file> [round model]'); process.exit(2) }
  let d
  try { d = decide(readFileSync(planFile, 'utf8'), readFileSync(verdictFile, 'utf8')) }
  catch (e) { console.error(e.message); process.exit(1) }
  if (!d.ok) console.error(d.errors.join('\n'))
  console.log(render && d.ok ? renderComment(d, { round: Number(round) || 1, model: model || '' }) : JSON.stringify(d))
  process.exit(d.ok ? 0 : 1)
}
