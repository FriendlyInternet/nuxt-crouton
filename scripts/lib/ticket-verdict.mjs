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
 *   - 3: PASS|FAIL — one line of evidence          (ids: 3 4 5 6 7 8 9)
 *   ### Question          (only for needs-owner: ONE yes/no question)
 *
 * Items 8 (rule stated and tested) and 9 (contradicts the record) are the two made explicit for
 * tickets. Item 8 also has a DETERMINISTIC floor (`precheck`) so a lenient model cannot wave
 * through a behaviour ticket that names neither a rule nor a test.
 *
 *   node scripts/lib/ticket-verdict.mjs <tickets.json> <verdict-file>        → JSON decision
 *   node scripts/lib/ticket-verdict.mjs render <tickets.json> <verdict-file> [model]
 *   node scripts/lib/ticket-verdict.mjs releasable <tickets.json>            → numbers to start now
 * tickets.json = [{ number, title, body, labels: ["type:feat", …] }]. Exit 1 on a malformed verdict.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBlockers } from '../wave-gate.mjs'
import { parsePipelineBlock } from '../pipeline-context.mjs'

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
]
const IDS = RUBRIC.map((r) => r.id)
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

/** PURE. Parse the reviewer's file → { ok, errors, tickets: { [n]: { stated, items, question } } }. */
export function parseVerdicts(body) {
  const errors = []
  if (!body.includes(TICKET_MARKER)) errors.push(`missing marker ${TICKET_MARKER}`)
  const tickets = {}
  const parts = body.split(/^##\s+Ticket\s+#(\d+)\s*$/im)
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i])
    const chunk = parts[i + 1]
    const stated = section(chunk, 'Verdict').toLowerCase().replace(/[^a-z-]/g, ' ').trim().split(/\s+/)[0] || ''
    if (!['go', 'no-go', 'needs-owner'].includes(stated)) errors.push(`#${n}: Verdict must be go, no-go or needs-owner`)
    const items = {}
    for (const line of section(chunk, 'Rubric').split('\n')) {
      const m = line.match(/^\s*(?:[-*]\s+)?\**([1-9])\**[.:)]?\s*[^\n]*?\b(PASS|FAIL)\b\W*(.*)$/i)
      if (m) items[m[1]] = { pass: m[2].toUpperCase() === 'PASS', evidence: m[3].replace(/\*\*/g, '').trim() }
    }
    for (const id of IDS) {
      if (!items[id]) errors.push(`#${n}: rubric item ${id} missing a PASS/FAIL line`)
      else if (!items[id].evidence) errors.push(`#${n}: rubric item ${id} has no evidence`)
    }
    tickets[n] = { stated, items, question: section(chunk, 'Question') }
  }
  if (!Object.keys(tickets).length) errors.push('no "## Ticket #N" sections found')
  return { ok: errors.length === 0, errors, tickets }
}

/** PURE. Merge floor + reviewer into one decision per ticket and an overall one for the epic. */
export function decide(tickets, verdictBody) {
  const v = parseVerdicts(verdictBody)
  if (!v.ok) return { ok: false, errors: v.errors }
  const errors = []
  const per = []
  for (const t of tickets) {
    const r = v.tickets[t.number]
    if (!r) { errors.push(`#${t.number}: reviewer gave no verdict for this ticket`); continue }
    const floor = precheck(t)
    const items = {}
    for (const id of IDS) items[id] = floor[id] || r.items[id]
    const failed = IDS.filter((id) => !items[id].pass)
    const hard = failed.filter((id) => id !== '7')
    const verdict = hard.length ? 'no-go' : !items['7'].pass ? 'needs-owner' : 'go'
    if (r.stated === 'go' && verdict !== 'go' && !Object.keys(floor).length) errors.push(`#${t.number}: reviewer said go but its own rubric fails: ${failed.join(', ')}`)
    if (verdict === 'needs-owner' && !r.question) errors.push(`#${t.number}: needs-owner needs a Question section`)
    per.push({ number: t.number, title: t.title, verdict, items, failed, question: r.question })
  }
  if (errors.length) return { ok: false, errors }
  const verdict = per.some((p) => p.verdict === 'no-go') ? 'no-go' : per.some((p) => p.verdict === 'needs-owner') ? 'needs-owner' : 'go'
  return { ok: true, verdict, tickets: per }
}

/** PURE. The typed-brief comment for the epic (plain language, depth collapsed). */
export function renderComment(d, { model = '' } = {}) {
  const bad = d.tickets.filter((t) => t.verdict !== 'go')
  const head = {
    go: `✅ **Tickets approved** — all ${d.tickets.length} read fine. The first ticket starts now.\n**Next:** none.`,
    'no-go': `🔴 **Tickets sent back** — ${bad.length} of ${d.tickets.length} would build something wrong. Nothing has started.\n**Needs:** action — fix the tickets listed below, then re-run the ticket review.`,
    'needs-owner': `🔀 **Needs your call** — ${bad.find((t) => t.question)?.question}\n**Needs:** answer`,
  }[d.verdict]
  const detail = d.tickets.map((t) => {
    const lines = RUBRIC.map((r) => `- ${t.items[r.id].pass ? '✅' : '❌'} **${r.id}. ${r.name}** — ${t.items[r.id].evidence}`).join('\n')
    return `#### ${t.verdict === 'go' ? '✅' : '❌'} #${t.number} ${t.title} — ${t.verdict}\n\n${lines}`
  }).join('\n\n')
  return `${TICKET_MARKER}\n<!-- ticket-review-verdict:${d.verdict} -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _ticket review${model ? ` on \`${model}\`` : ''}_\n\n${head}\n\n<details><summary>Review checklist per ticket</summary>\n\n${detail}\n\n</details>\n`
}

/** PURE. Tickets to start the moment the epic is approved: no blockers, not already dispatched. */
export function releasable(tickets, triggerLabels = ['work-this', 'delegate-pi', 'delegate']) {
  return tickets
    .filter((t) => !parseBlockers(t.body).length && !labelNames(t).some((l) => triggerLabels.includes(l)))
    .map((t) => ({ number: t.number, label: parsePipelineBlock(t.body).dispatch || 'work-this' }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const mode = ['render', 'releasable'].includes(args[0]) ? args.shift() : 'decide'
  const [ticketsFile, verdictFile, model] = args
  if (!ticketsFile || (mode !== 'releasable' && !verdictFile)) { console.error('usage: ticket-verdict.mjs [render|releasable] <tickets.json> [verdict-file] [model]'); process.exit(2) }
  const tickets = JSON.parse(readFileSync(ticketsFile, 'utf8'))
  if (mode === 'releasable') { console.log(JSON.stringify(releasable(tickets))); process.exit(0) }
  const d = decide(tickets, readFileSync(verdictFile, 'utf8'))
  if (!d.ok) console.error(d.errors.join('\n'))
  console.log(mode === 'render' && d.ok ? renderComment(d, { model: model || '' }) : JSON.stringify(d))
  process.exit(d.ok ? 0 : 1)
}
