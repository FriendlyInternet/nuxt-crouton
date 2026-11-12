/**
 * Verdict parser + rubric for the independent TICKET reviewer (#2776, epic #2754).
 *
 * Same reviewer tier and rubric spirit as the plan reviewer (plan-verdict.mjs), applied to an
 * epic's tickets BEFORE the first one starts. The reviewer (persona .claude/agents/ticket-reviewer.md)
 * writes ONE file with one section per ticket:
 *
 *   <!-- ticket-review:v1 -->
 *   ## Ticket #2725
 *   ### Verdict
 *   go | no-go | needs-owner
 *   ### Rubric
 *   - 3: PASS|FAIL — one line of evidence          (ids: 3 4 5 6 7 8 9 10)
 *   ### Question          (only for needs-owner: ONE yes/no question)
 *
 * Rolling epics (#3846) add an optional `## Plan` section — the step list graded once on P1–P4
 * (coverage, order, size, no owner decision; no file-and-line item) — and a 4th ticket verdict,
 * `plan-wrong` (needs a `### Why`), for a ticket that shows the step list itself is wrong. With
 * `--subject plan` a verdict file with a `## Plan` section and NO ticket section is valid (a plan
 * review re-run after step 0's ticket closed). The comment carries `<!-- ticket-review-subject:… -->`
 * markers so rounds are counted per plan and per ticket (lib/epic-steps.mjs countRounds).
 *
 * Items 8 (rule stated and tested) and 9 (contradicts the record) are the two made explicit for
 * tickets. Item 8 also has a DETERMINISTIC floor (`precheck`) so a lenient model cannot wave
 * through a behaviour ticket that names neither a rule nor a test.
 *
 *   node scripts/lib/ticket-verdict.mjs <tickets.json> <verdict-file> [--subject S]  → JSON decision
 *   node scripts/lib/ticket-verdict.mjs render <tickets.json> <verdict-file> [model] [--revising R] [--subject S]
 *   node scripts/lib/ticket-verdict.mjs releasable <tickets.json>            → numbers to start now
 * tickets.json = [{ number, title, body, labels: ["type:feat", …] }]. Exit 1 on a malformed verdict.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBlockers } from '../wave-gate.mjs'
import { parsePipelineBlock } from '../pipeline-context.mjs'
import { subjectMarker, PLAN_GO_MARKER } from './epic-steps.mjs'

export const TICKET_MARKER = '<!-- ticket-review:v1 -->'
export const APPROVED_LABEL = 'tickets:approved'
export const RUBRIC = [
  { id: '3', name: 'No unverified assumptions' },
  { id: '4', name: 'Smallest change (no over-engineering)' },
  { id: '5', name: 'Best practice, no hacks' },
  { id: '6', name: 'Scope is one coherent change' },
  { id: '7', name: 'No owner decision needed' },
  { id: '8', name: 'Rule stated? (names what must stay true and asks for a test aimed at that rule, not only the mechanism)' },
  { id: '9', name: 'Contradicts the record? (no instruction conflicts with the epic Decisions log, a recorded experiment or a merged finding)' },
  { id: '10', name: 'Own test steps? (every How-to-test step exercises only this ticket, not a sibling)' },
]
const IDS = RUBRIC.map((r) => r.id)
/** The step-list rubric (#3846): idea/order/size/coverage only — no file-and-line checks for later steps. */
export const PLAN_RUBRIC = [
  { id: 'P1', name: 'Reaches the goal (the steps together cover the epic)' },
  { id: 'P2', name: 'Order (each step\'s preconditions are met by earlier steps)' },
  { id: 'P3', name: 'Size (each step is one coherent change)' },
  { id: 'P4', name: 'No owner decision needed' },
]
const PLAN_IDS = PLAN_RUBRIC.map((r) => r.id)
const VERDICTS = ['go', 'no-go', 'needs-owner', 'plan-wrong']
const BEHAVIOUR = /^type:(feat|fix|perf|refactor)$/
const labelNames = (t) => (t.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)

/** PURE. Is this epic's ticket set worth a review? Skips docs/chore-only sets and pocs/-only sets. */
export function shouldReview(tickets) {
  if (!tickets.length) return false
  const trivial = (t) => {
    const ls = labelNames(t)
    if (ls.includes('type:docs') || ls.includes('type:chore')) return true
    const body = t.body || ''
    return /\bpocs\//.test(body) && !/\b(packages|apps)\//.test(body)
  }
  return !tickets.every(trivial)
}

/** PURE. Deterministic floor: failing item ids → evidence, from the ticket text alone. */
export function precheck(ticket) {
  const fails = {}
  if (labelNames(ticket).some((l) => BEHAVIOUR.test(l))) {
    const body = (ticket.body || '').replace(/<!--[\s\S]*?-->/g, '')
    if (!/\brule\b/i.test(body)) fails['8'] = { pass: false, evidence: 'behaviour ticket never names the rule that must hold (write a "Rule:" line)' }
    else if (!/\btests?\b/i.test(body)) fails['8'] = { pass: false, evidence: 'ticket names no test aimed at the rule' }
  }
  return fails
}

const section = (body, name) => {
  const m = body.match(new RegExp(`^#{2,4}\\s+\\**\\s*${name}\\s*\\**\\s*$([\\s\\S]*?)(?=^#{2,4}\\s|(?![\\s\\S]))`, 'im'))
  return m ? m[1].trim() : ''
}

const statedOf = (chunk) => section(chunk, 'Verdict').toLowerCase().replace(/[^a-z-]/g, ' ').trim().split(/\s+/)[0] || ''

/** PURE. The `## Plan` section (#3846) → null when absent, else { stated, items, question, errors }. */
export function parsePlanSection(body) {
  const m = String(body || '').match(/^##\s+Plan\s*$([\s\S]*?)(?=^##\s+Ticket\s+#|(?![\s\S]))/im)
  if (!m) return null
  const chunk = m[1]
  const errors = []
  const stated = statedOf(chunk)
  if (!['go', 'no-go', 'needs-owner'].includes(stated)) errors.push('plan: Verdict must be go, no-go or needs-owner')
  const items = {}
  for (const line of section(chunk, 'Rubric').split('\n')) {
    const r = line.match(/^\s*(?:[-*]\s+)?\**(P[1-4])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
    if (r) items[r[1].toUpperCase()] = { pass: r[2].toUpperCase() === 'PASS', evidence: r[3].replace(/\*\*/g, '').trim() }
  }
  for (const id of PLAN_IDS) {
    if (!items[id]) errors.push(`plan: rubric item ${id} missing a PASS/FAIL line`)
    else if (!items[id].evidence) errors.push(`plan: rubric item ${id} has no evidence`)
  }
  return { stated, items, question: section(chunk, 'Question'), errors }
}

/** PURE. Parse the reviewer's file → { ok, errors, plan, tickets: { [n]: { stated, items, question, why } } }. */
// fallow-ignore-next-line complexity -- linear line-format parser; the branches are one guard per reviewer-file shape, covered by ticket-verdict.test.mjs (#2776)
export function parseVerdicts(body, { subject = '' } = {}) {
  const errors = []
  if (!body.includes(TICKET_MARKER)) errors.push(`missing marker ${TICKET_MARKER}`)
  const plan = parsePlanSection(body)
  if (plan) errors.push(...plan.errors)
  if (subject === 'plan' && !plan) errors.push('a plan review (subject=plan) needs a "## Plan" section')
  const tickets = {}
  const parts = body.split(/^##\s+Ticket\s+#(\d+)\s*$/im)
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i])
    const chunk = parts[i + 1]
    const stated = statedOf(chunk)
    if (!VERDICTS.includes(stated)) errors.push(`#${n}: Verdict must be go, no-go, needs-owner or plan-wrong`)
    const why = section(chunk, 'Why')
    if (stated === 'plan-wrong' && !why) errors.push(`#${n}: plan-wrong needs a Why section`)
    const items = {}
    for (const line of section(chunk, 'Rubric').split('\n')) {
      const m = line.match(/^\s*(?:[-*]\s+)?\**(10|[1-9])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
      if (m) items[m[1]] = { pass: m[2].toUpperCase() === 'PASS', evidence: m[3].replace(/\*\*/g, '').trim() }
    }
    for (const id of IDS) {
      if (!items[id]) errors.push(`#${n}: rubric item ${id} missing a PASS/FAIL line`)
      else if (!items[id].evidence) errors.push(`#${n}: rubric item ${id} has no evidence`)
    }
    tickets[n] = { stated, items, question: section(chunk, 'Question'), why }
  }
  // A plan review may grade the step list alone (step 0's ticket already closed, #3846); any other
  // review must grade at least one ticket.
  if (!Object.keys(tickets).length && !(subject === 'plan' && plan)) errors.push('no "## Ticket #N" sections found')
  return { ok: errors.length === 0, errors, plan, tickets }
}

/** PURE. The plan's merged verdict: P1–P3 FAIL → no-go, P4 FAIL → needs-owner, else go. */
function decidePlan(p, errors) {
  const failed = PLAN_IDS.filter((id) => !p.items[id].pass)
  const verdict = failed.some((id) => id !== 'P4') ? 'no-go' : failed.includes('P4') ? 'needs-owner' : 'go'
  if (p.stated === 'go' && verdict !== 'go') errors.push(`plan: reviewer said go but its own rubric fails: ${failed.join(', ')}`)
  if (verdict === 'needs-owner' && !p.question) errors.push('plan: needs-owner needs a Question section')
  return { verdict, items: p.items, failed, question: p.question }
}

/** PURE. Merge floor + reviewer into one decision per ticket and an overall one for the epic. */
// fallow-ignore-next-line complexity -- one flat pass merging floor + reviewer per ticket; each branch is a distinct disagreement rule, covered by ticket-verdict.test.mjs (#2776)
export function decide(tickets, verdictBody, { subject = '' } = {}) {
  const v = parseVerdicts(verdictBody, { subject })
  if (!v.ok) return { ok: false, errors: v.errors }
  const errors = []
  const per = []
  const plan = v.plan ? decidePlan(v.plan, errors) : null
  for (const t of tickets) {
    const r = v.tickets[t.number]
    if (!r) { errors.push(`#${t.number}: reviewer gave no verdict for this ticket`); continue }
    const floor = precheck(t)
    const items = {}
    for (const id of IDS) items[id] = floor[id] || r.items[id]
    const failed = IDS.filter((id) => !items[id].pass)
    const hard = failed.filter((id) => id !== '7' && id !== '10')
    // Only an owner decision (7) holds; a check-10 wording failure goes to the automatic rewrite (#3833).
    // plan-wrong (#3846): the reviewer says the STEP LIST is wrong, whatever this ticket's rubric says.
    const verdict = r.stated === 'plan-wrong' ? 'plan-wrong' : hard.length ? 'no-go' : !items['7'].pass ? 'needs-owner' : !items['10'].pass ? 'no-go' : 'go'
    if (r.stated === 'go' && verdict !== 'go' && !Object.keys(floor).length) errors.push(`#${t.number}: reviewer said go but its own rubric fails: ${failed.join(', ')}`)
    if (verdict === 'needs-owner' && !r.question) errors.push(`#${t.number}: needs-owner needs a Question section`)
    per.push({ number: t.number, title: t.title, body: t.body, verdict, items, failed, question: r.question, why: r.why })
  }
  if (errors.length) return { ok: false, errors }
  const all = [...(plan ? [plan.verdict] : []), ...per.map((p) => p.verdict)]
  const verdict = ['plan-wrong', 'no-go', 'needs-owner'].find((x) => all.includes(x)) || 'go'
  return { ok: true, verdict, plan, tickets: per }
}

/** PURE. The typed-brief comment for the epic (plain language, depth collapsed). */
// `revising: R` (#3787) = ticket-revise.yml is about to rewrite the sent-back tickets (round R of 3),
// so the owner is not asked to do the work the pipeline is doing.
// `subject` (#3846): '' = the whole set (legacy); 'plan' or '<n>' = a rolling-epic review. A subject
// review writes one `<!-- ticket-review-subject:… -->` marker per subject it graded (the plan and
// each ticket), so rounds are counted per plan and per ticket.
export function renderComment(d, { model = '', revising = 0, subject = '' } = {}) {
  const head = renderHead(d, { revising, subject })
  const markers = renderMarkers(d, subject)
  return `${TICKET_MARKER}\n<!-- ticket-review-verdict:${d.verdict} -->\n${markers}> 🤖 **pi.dev harness** · agent pipeline (CI) · _ticket review${model ? ` on \`${model}\`` : ''}_\n\n${head}\n\n<details><summary>Review checklist per ticket</summary>\n\n${renderPlanDetail(d.plan)}${renderTicketDetail(d.tickets)}\n\n</details>\n`
}

const FIX_STEPS = '**Needs:** action — fix the step-list comment by hand, then re-run the plan review (`subject=plan`).'

/** The visible typed-brief line(s) for the verdict. */
function renderHead(d, { revising, subject }) {
  const bad = d.tickets.filter((t) => t.verdict !== 'go')
  const planBad = d.plan && d.plan.verdict !== 'go'
  const wrong = d.tickets.find((t) => t.verdict === 'plan-wrong')
  if (d.verdict === 'go') return renderGoHead(d, subject)
  if (d.verdict === 'plan-wrong') return `🔀 **The step list looks wrong** — ${(wrong?.why || '').split('\n')[0]}\n${FIX_STEPS}`
  if (d.verdict === 'no-go') return planBad ? `🔴 **Step list sent back** — ${d.plan.failed.join(', ')} failed. Nothing has started.\n${FIX_STEPS}` : renderSentBackHead(d, bad, revising)
  if (d.verdict === 'needs-owner') return `🔀 **Needs your call** — ${(planBad && d.plan.question) || bad.find((t) => t.question)?.question}\n**Needs:** answer`
  return undefined
}

function renderGoHead(d, subject) {
  if (!subject) return `✅ **Tickets approved** — all ${d.tickets.length} read fine. The first ticket starts now.\n**Next:** none.`
  const what = d.plan ? 'Step list' + (d.tickets.length ? ' and ticket' : '') : 'Ticket'
  const then = d.tickets.length ? d.tickets.map((t) => `#${t.number}`).join(', ') + ' can start.' : 'no open ticket to start yet.'
  return `✅ **${what} approved** — ${then}\n**Next:** none.`
}

function renderSentBackHead(d, bad, revising) {
  const sentBack = `🔴 **Tickets sent back** — ${bad.length} of ${d.tickets.length} would build something wrong.`
  return revising
    ? `${sentBack} Rewriting them from this review now (round ${revising} of 3).\n**Next:** none.`
    : `${sentBack} Nothing has started.\n**Needs:** action — fix the tickets listed below, then re-run the ticket review.`
}

function renderTicketDetail(tickets) {
  return tickets.map((t) => {
    const lines = RUBRIC.map((r) => `- ${t.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${t.items[r.id].evidence}`).join('\n')
    const why = t.why ? `\n\n**Why the step list is wrong:** ${t.why}` : ''
    return `#### ${t.verdict === 'go' ? '✅' : '❌'} #${t.number} ${t.title} — ${t.verdict}\n\n${lines}${why}`
  }).join('\n\n')
}

function renderPlanDetail(plan) {
  if (!plan) return ''
  const lines = PLAN_RUBRIC.map((r) => `- ${plan.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${plan.items[r.id].evidence}`).join('\n')
  return `#### ${plan.verdict === 'go' ? '✅' : '❌'} Step list — ${plan.verdict}\n\n${lines}\n\n`
}

/** One subject marker per subject graded (so rounds count per plan / per ticket) + the plan-go marker. */
function renderMarkers(d, subject) {
  const subjects = subject ? [...new Set([...(d.plan ? ['plan'] : []), ...(subject === 'plan' ? [] : [subject]), ...d.tickets.map((t) => String(t.number))])] : []
  return subjects.map((s) => `${subjectMarker(s)}\n`).join('') + (d.plan?.verdict === 'go' ? `${PLAN_GO_MARKER}\n` : '')
}

/** PURE. Tickets to start the moment the epic is approved: no blockers, not already dispatched. */
export function releasable(tickets, triggerLabels = ['work-this', 'delegate-pi', 'delegate']) {
  return tickets
    .filter((t) => !parseBlockers(t.body).length && !labelNames(t).some((l) => triggerLabels.includes(l)))
    .map((t) => ({ number: t.number, label: parsePipelineBlock(t.body).dispatch || 'work-this' }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const ri = args.indexOf('--revising')
  const revising = ri >= 0 ? Number(args.splice(ri, 2)[1]) || 0 : 0
  const si = args.indexOf('--subject')
  const subject = si >= 0 ? String(args.splice(si, 2)[1] || '').trim() : ''
  const mode = ['render', 'releasable'].includes(args[0]) ? args.shift() : 'decide'
  const [ticketsFile, verdictFile, model] = args
  if (!ticketsFile || (mode !== 'releasable' && !verdictFile)) { console.error('usage: ticket-verdict.mjs [render|releasable] <tickets.json> [verdict-file] [model]'); process.exit(2) }
  const tickets = JSON.parse(readFileSync(ticketsFile, 'utf8'))
  if (mode === 'releasable') { console.log(JSON.stringify(releasable(tickets))); process.exit(0) }
  const d = decide(tickets, readFileSync(verdictFile, 'utf8'), { subject })
  if (!d.ok) console.error(d.errors.join('\n'))
  console.log(mode === 'render' && d.ok ? renderComment(d, { model: model || '', revising, subject }) : JSON.stringify(d))
  process.exit(d.ok ? 0 : 1)
}
