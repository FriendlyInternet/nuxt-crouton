/**
 * Rolling epics (#3846): review the plan once, then one ticket at a time. PURE + a small CLI; Node core only.
 *
 * WHY. The decomposer used to write every child ticket up front and ticket-review.yml graded all of
 * them against today's code, deciding go/no-go for the WHOLE epic. A later ticket names code an
 * earlier step has not built yet, so each round found new real gaps and one no-go held every ticket
 * (#3763: 14 rounds, 6 of 8 tickets go, all 8 held). An epic labelled `tickets:rolling` instead has:
 *   • a STEP LIST — one harness-bot comment marked `<!-- epic-steps:v1 -->`, edited in place, with a
 *     fenced JSON array `[{ step, title, goal, proves, blockedBy: [stepIdx], needsSplit, ticket }]`;
 *   • a plan review once (`ticket-review.yml -f subject=plan`), and a review per ticket
 *     (`-f subject=<n>`) just before it is built, graded against the epic branch;
 *   • a verdict and a round count PER TICKET: a go ticket starts, a no-go holds only itself and the
 *     steps that depend on it — never a sibling that is already go.
 * Later tickets are written BY HAND by the orchestrator (owner decision 2026-11-12 12:54) with
 * `<!-- pipeline: epic=<E> step=<k> -->` in the body; nothing writes them automatically.
 *
 * Rules (tested in epic-steps.test.mjs):
 *   - a ticket's start depends only on the plan verdict, its own verdict and its own step's blockers;
 *   - a rolling epic is finished only when every step in its step list has a closed ticket.
 *
 *   node scripts/lib/epic-steps.mjs steps <comments.json>                       → the step list JSON (or nothing)
 *   node scripts/lib/epic-steps.mjs narrow <subject> <tickets.json> [steps.json] → the tickets this review reads
 * comments.json = `[{ body, user: { login, type } }]` (the GitHub API shape), oldest first.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const HARNESS_BOT = 'nuxt-harness[bot]'
/** PURE. Is this comment the harness bot's own? A bare string has no author, so it never is. */
export const isHarnessBot = (c) =>
  c?.user?.type === 'Bot' && String(c?.user?.login || '').toLowerCase() === HARNESS_BOT

export const STEPS_MARKER = '<!-- epic-steps:v1 -->'
export const ROLLING_LABEL = 'tickets:rolling'
export const STEPS_APPROVED_LABEL = 'steps:approved'
export const PLAN_WRONG_MARKER = '<!-- epic-plan-wrong -->'
export const VERDICT_MARKER = '<!-- ticket-review-verdict:'
export const PLAN_GO_MARKER = '<!-- ticket-review-plan:go -->'
export const MAX_ROUNDS = 3
export const subjectMarker = (s) => `<!-- ticket-review-subject:${s} -->`

/** Thrown on a malformed plan / step list. apply-decompose-plan.mjs re-exports it. */
export class PlanError extends Error {}

const labelNames = (x) => (x?.labels || x || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
export const isRolling = (labels) => labelNames({ labels }).includes(ROLLING_LABEL)

/** Validate one item's `blockedBy` → a sorted, de-duped array of in-range sibling indices. */
export function normalizeBlockedBy(raw, self, count, noun = 'child') {
  if (raw === undefined || raw === null) return []
  const list = Array.isArray(raw) ? raw : [raw]
  const out = new Set()
  for (const v of list) {
    if (!Number.isInteger(v)) throw new PlanError(`${noun}[${self}].blockedBy must contain sibling indices (integers), got ${JSON.stringify(v)}`)
    if (v === self) throw new PlanError(`${noun}[${self}].blockedBy cannot reference itself`)
    if (v < 0 || v >= count) throw new PlanError(`${noun}[${self}].blockedBy references sibling ${v}, which does not exist (0..${count - 1})`)
    out.add(v)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * A cycle would deadlock the whole tree: every item waits on another, none is ever dispatched,
 * and the epic silently stalls with no worker and no error. Fail LOUD at plan time instead.
 */
export function assertNoDependencyCycle(items, noun = 'child') {
  const state = new Array(items.length).fill(0) // 0 = unvisited, 1 = on stack, 2 = done
  const walk = (i, path) => {
    if (state[i] === 1) throw new PlanError(`${noun} dependency cycle: ${[...path, i].map((n) => `${noun}[${n}]`).join(' → ')}`)
    if (state[i] === 2) return
    state[i] = 1
    for (const dep of items[i].blockedBy) walk(dep, [...path, i])
    state[i] = 2
  }
  for (let i = 0; i < items.length; i++) walk(i, [])
}

/** PURE. Validate a raw step list → `[{ step, title, goal, proves, blockedBy, needsSplit, ticket }]`. */
export function normalizeSteps(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new PlanError('steps must be a non-empty array')
  const text = (s, i, k) => {
    if (typeof s?.[k] !== 'string' || !s[k].trim()) throw new PlanError(`step[${i}] needs a non-empty ${k}`)
    return s[k].trim()
  }
  const steps = raw.map((s, i) => {
    if (!s || typeof s !== 'object') throw new PlanError(`step[${i}] must be an object`)
    const t = s.ticket
    if (t !== undefined && t !== null && !(Number.isInteger(t) && t > 0)) throw new PlanError(`step[${i}].ticket must be an issue number or null, got ${JSON.stringify(t)}`)
    return {
      step: i,
      title: text(s, i, 'title'),
      goal: text(s, i, 'goal'),
      proves: text(s, i, 'proves'),
      blockedBy: normalizeBlockedBy(s.blockedBy, i, raw.length, 'step'),
      needsSplit: !!s.needsSplit,
      ticket: t ?? null,
    }
  })
  assertNoDependencyCycle(steps, 'step')
  return steps
}

/** PURE. The step-list comment body (plain language first, the machine-readable list fenced below). */
export function renderSteps(steps) {
  const list = steps.map((s) => {
    const after = s.blockedBy.length ? ` _(after step ${s.blockedBy.join(', ')})_` : ''
    const t = s.ticket ? ` — #${s.ticket}` : ' — ticket not written yet'
    return `${s.step}. **${s.title}**${after}${t}\n   - Goal: ${s.goal}\n   - Proves: ${s.proves}`
  }).join('\n')
  return `${STEPS_MARKER}\n<!-- pipeline-note -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _epic step list (#3846)_\n\n` +
    `📋 **Step list** — ${steps.length} step(s). Each step gets its ticket just before it is built.\n\n${list}\n\n` +
    `<details><summary>Machine-readable list (edit in place to fix the plan, then re-run the plan review)</summary>\n\n` +
    '```json\n' + JSON.stringify(steps, null, 2) + '\n```\n\n</details>\n'
}

/** PURE. The newest harness-bot step-list comment, or null. */
export function stepsComment(comments = []) {
  return (Array.isArray(comments) ? comments : []).filter((c) => isHarnessBot(c) && String(c.body || '').includes(STEPS_MARKER)).at(-1) || null
}

/** PURE. The step list on the epic (bot-authored only), or null when there is none or it is unreadable. */
export function parseSteps(comments = []) {
  const c = stepsComment(comments)
  if (!c) return null
  const m = String(c.body).match(/```json\s*\n([\s\S]*?)\n```/)
  if (!m) return null
  try { return normalizeSteps(JSON.parse(m[1])) } catch { return null }
}

/** PURE. The `step=<k>` key of a body's pipeline block, or null. */
export function stepOf(body = '') {
  const m = String(body || '').match(/<!--\s*pipeline:[^>]*?\bstep=(\d+)\b[^>]*-->/i)
  return m ? Number(m[1]) : null
}

/** PURE. step index → issue number: the step list's `ticket`, else a sub-issue carrying `step=<k>`. */
export function ticketsByStep(steps = [], subIssues = []) {
  const out = {}
  for (const s of steps || []) if (s.ticket) out[s.step] = s.ticket
  for (const i of subIssues || []) {
    const k = i.step ?? stepOf(i.body)
    if (k !== null && k !== undefined && out[k] === undefined) out[k] = i.number
  }
  return out
}

/**
 * PURE. How many steps of a rolling epic are not finished (no ticket yet, or its ticket is open)?
 * 0 for an epic without `tickets:rolling` (nothing changes there), and 0 for a rolling epic with no
 * bot step list (fail open: an existing epic opted in by label has all its tickets already, so
 * "every sub-issue closed" is the right finish line there).
 */
export function stepsPending({ labels = [], comments = [], subIssues = [] } = {}) {
  return pendingDetail({ labels, comments, subIssues }).pending
}

export function pendingDetail({ labels = [], comments = [], subIssues = [] } = {}) {
  if (!isRolling(labels)) return { pending: 0, reason: 'not a rolling epic' }
  const steps = parseSteps(comments)
  if (!steps) return { pending: 0, reason: 'rolling epic with no bot step list — every sub-issue closed is the finish line' }
  const byStep = ticketsByStep(steps, subIssues)
  const state = new Map((subIssues || []).map((i) => [i.number, i.state]))
  const pending = steps.filter((s) => !byStep[s.step] || state.get(byStep[s.step]) !== 'closed').length
  return { pending, reason: `${pending} of ${steps.length} step(s) not finished` }
}

/**
 * PURE. What a review reads: `plan` → the open ticket(s) of steps with no blocker (usually step 0's,
 * possibly none); `<n>` → that ticket only; blank → every open ticket (today).
 */
export function narrowToSubject({ subject = '', tickets = [], steps = null } = {}) {
  const s = String(subject || '').trim()
  const open = (tickets || []).filter((t) => !t.state || t.state === 'open')
  if (!s) return open
  if (s === 'plan') {
    const byStep = ticketsByStep(steps || [], open)
    const roots = new Set((steps || []).filter((x) => !x.blockedBy.length).map((x) => byStep[x.step]).filter(Boolean))
    return open.filter((t) => roots.has(t.number))
  }
  return open.filter((t) => String(t.number) === s)
}

/** PURE. Bot verdict comments carrying the subject marker (plan | <n>). */
const subjectRe = (s) => new RegExp(`<!--\\s*ticket-review-subject:${String(s).replace(/[^\w]/g, '')}\\s*-->`)
export function verdictCommentsFor(comments = [], subject) {
  const re = subjectRe(subject)
  return (Array.isArray(comments) ? comments : []).filter(isHarnessBot)
    .map((c) => String(c.body || '')).filter((b) => b.includes(VERDICT_MARKER) && re.test(b))
}

/** PURE. The round of the verdict being posted now for `subject` (plan | <n>): its bot verdicts + 1. */
export function countRounds(comments = [], subject) {
  return verdictCommentsFor(comments, subject).length + 1
}

/** PURE. Is a bot `<!-- epic-plan-wrong -->` comment newer than the last bot plan go? */
export function planWrongOnRecord(comments = []) {
  let wrong = -1, go = -1
  ;(Array.isArray(comments) ? comments : []).forEach((c, i) => {
    if (!isHarnessBot(c)) return
    const b = String(c.body || '')
    if (b.includes(PLAN_WRONG_MARKER)) wrong = i
    if (b.includes(PLAN_GO_MARKER)) go = i
  })
  return wrong > go
}

/**
 * PURE. A verdict → which tickets start now and which hold. A go ticket is never held because of a
 * sibling; a no-go / needs-owner ticket holds itself and the tickets of steps that depend on it.
 *   decision = ticket-verdict.mjs decide() output · steps = the step list (or null)
 *   subIssues (optional) = to find tickets written by hand (`step=<k>`)
 */
/** Grow `hold` along the step list: a step waiting on a held step is held too (and so is its ticket). */
function holdDependentSteps(steps, byStep, held, hold) {
  const stepOfTicket = new Map(Object.entries(byStep).map(([k, n]) => [n, Number(k)]))
  const heldSteps = new Set(held.map((n) => stepOfTicket.get(n)).filter((k) => k !== undefined))
  let grew = true
  while (grew) {
    grew = false
    for (const s of steps) {
      if (heldSteps.has(s.step) || !s.blockedBy.some((b) => heldSteps.has(b))) continue
      heldSteps.add(s.step); grew = true
      if (byStep[s.step]) hold.add(byStep[s.step])
    }
  }
}

export function splitVerdict(decision, steps = null, subIssues = []) {
  const per = decision?.tickets || []
  const held = per.filter((t) => t.verdict !== 'go').map((t) => t.number)
  const hold = new Set(held)
  if (steps && held.length) {
    const byStep = ticketsByStep(steps, [...subIssues, ...per.map((t) => ({ number: t.number, body: t.body }))])
    holdDependentSteps(steps, byStep, held, hold)
  }
  const start = per.filter((t) => t.verdict === 'go' && !hold.has(t.number)).map((t) => t.number)
  return { start, hold: [...hold].sort((a, b) => a - b) }
}

/**
 * PURE. What does this epic need next? → a list of
 *   { type:'plan-review' } · { type:'write-ticket', step } (a REPORT — written by hand) ·
 *   { type:'review-ticket', n } · { type:'start', n, label } · { type:'revise', n } ·
 *   { type:'hold', target: n|'plan', reason } · { type:'done' }
 * state = { rolling, plan: { verdict, round, wrong }, steps, tickets: { [n]: { state, verdict, round, started, label, step } } }
 */
// fallow-ignore-next-line complexity -- one flat pass over the epic's state; each branch is one row of the #3846 decision table, covered by epic-steps.test.mjs
export function nextAction({ rolling = false, plan = {}, steps = null, tickets = {} } = {}) {
  if (!rolling) return []
  const entries = Object.entries(tickets || {}).map(([n, t]) => ({ n: Number(n), ...t }))
  const planWrong = entries.some((t) => t.state !== 'closed' && t.verdict === 'plan-wrong')
  if (planWrong || (plan.verdict === 'go' && plan.wrong)) return [{ type: 'hold', target: 'plan', reason: 'plan-wrong' }]
  if (steps && !plan.verdict) return [{ type: 'plan-review' }]
  if (steps && plan.verdict !== 'go') {
    return [{ type: 'hold', target: 'plan', reason: (plan.round || 0) >= MAX_ROUNDS ? 'round-cap' : plan.verdict }]
  }
  const out = []
  for (const t of entries) {
    if (t.state === 'closed') continue
    if (!t.verdict) out.push({ type: 'review-ticket', n: t.n })
    else if (t.verdict === 'go') { if (!t.started) out.push({ type: 'start', n: t.n, label: t.label || 'work-this' }) }
    else if (t.verdict === 'needs-owner') out.push({ type: 'hold', target: t.n, reason: 'needs-owner' })
    else if ((t.round || 0) >= MAX_ROUNDS) out.push({ type: 'hold', target: t.n, reason: 'round-cap' })
    else out.push({ type: 'revise', n: t.n })
  }
  if (steps) {
    const byStep = ticketsByStep(steps, entries.map((t) => ({ number: t.n, step: t.step ?? null })))
    const closed = (k) => byStep[k] && tickets[byStep[k]]?.state === 'closed'
    for (const s of steps) {
      if (!byStep[s.step] && s.blockedBy.every(closed)) out.push({ type: 'write-ticket', step: s.step })
    }
    if (steps.every((s) => closed(s.step))) return [{ type: 'done' }]
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, a, b, c] = process.argv.slice(2)
  const json = (f) => JSON.parse(readFileSync(f, 'utf8'))
  if (mode === 'steps' && a) {
    const steps = parseSteps(json(a))
    if (steps) console.log(JSON.stringify(steps))
  } else if (mode === 'narrow' && b) {
    const steps = c && existsSync(c) && readFileSync(c, 'utf8').trim() ? json(c) : null
    console.log(JSON.stringify(narrowToSubject({ subject: a, tickets: json(b), steps })))
  } else {
    console.error('usage: epic-steps.mjs steps <comments.json> | narrow <subject> <tickets.json> [steps.json]')
    process.exit(2)
  }
}
