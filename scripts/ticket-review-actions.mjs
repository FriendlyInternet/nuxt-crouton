#!/usr/bin/env node
// ticket-review-actions.mjs — what ticket-review.yml does after a verdict (#3846). PURE core + a CLI.
//
// The workflow step only runs the lines this prints (#3452: decisions live in scripts/, not YAML).
// One JSON object per line, by `kind`:
//   { kind:'label',    issue, label }              → node scripts/handoff-exec.mjs label
//   { kind:'dispatch', issue, workflow, inputs }    → node scripts/handoff-exec.mjs dispatch
//   { kind:'unlabel',  issue, label }               → gh issue edit --remove-label
//   { kind:'block',    issue }                      → gh issue edit --add-label status:blocked
//   { kind:'note',     text }                       → appended to the verdict comment + job summary
//
// An epic WITHOUT `tickets:rolling` keeps today's whole-epic flow exactly (go → `tickets:approved` +
// release the unblocked tickets; no-go → ticket-revise.yml under the 3-round cap, else hold;
// needs-owner → hold). A ROLLING epic decides per ticket:
//   rule: a ticket's start depends only on the plan verdict, its own verdict and its own step's
//   blockers — never on a sibling's verdict.
//   • plan go → `steps:approved` on the epic; a go ticket starts at once (once the plan is approved);
//   • any other step-list verdict removes `steps:approved`; with a step list, a ticket never starts
//     unless the label is on AND the newest bot step-list verdict is a go;
//   • a go ticket whose step is blocked by steps with a still-open (or unwritten) ticket is PARKED
//     (a note, no label) and starts on the review run once those tickets close;
//   • a no-go ticket → ticket-revise.yml for THAT ticket (`subject=<n>`), 3 rounds per ticket, then hold;
//   • needs-owner → hold; a plan no-go / needs-owner → hold (the step list is fixed by hand);
//   • plan-wrong (a ticket verdict, or a newer bot `<!-- epic-plan-wrong -->` comment) → remove
//     `steps:approved` + hold. Nothing is dispatched to the decomposer; started tickets keep running.
//   • a step-list comment that is there but cannot be read or validated → hold the epic with the
//     reason (which field is wrong); no ticket starts and the epic never counts as finished;
//   • a step whose blockers' tickets are closed and that has no ticket → a NOTE only: the
//     orchestrator writes that ticket by hand (owner decision 2026-11-12 12:54).
//
//   node scripts/ticket-review-actions.mjs <decision.json> <comments.json> <epic.json> <subs.json> [steps.json] [--subject S]
//   node scripts/ticket-review-actions.mjs gather <comments.json> <epic.json> <tickets.json> <steps.json> [--subject S]
//     → before the reviewer: hold the epic for an unreadable step list (`held=true` output), or fail on nothing to review
//   epic.json = { number, labels: [names] } · subs.json = every sub-issue { number, state, body, labels }
import { readFileSync, existsSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { releasable, APPROVED_LABEL } from './lib/ticket-verdict.mjs'
import { countRounds as legacyRounds, route } from './ticket-revise.mjs'
import { parsePipelineBlock } from './pipeline-context.mjs'
import { PIPELINE_LABELS } from './traffic-control.mjs'
import {
  ROLLING_LABEL, STEPS_APPROVED_LABEL, PLAN_GO_MARKER, countRounds, splitVerdict, nextAction, planWrongOnRecord, stepOf,
  verdictCommentsFor, readSteps,
} from './lib/epic-steps.mjs'

const names = (ls) => (ls || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
// Instruction TEXT for the orchestrator (a note in the verdict comment) — this file never dispatches.
const reviewCmd = (epic, subject) => `\`gh workflow ${'run'} ticket-review.yml -f epic=${epic} -f subject=${subject}\``

/** Today's whole-epic flow, unchanged (moved from ticket-review.yml's `case` block). */
export function legacyActions({ epic, decision, comments, tickets }) {
  const v = decision?.verdict
  if (v === 'go') {
    return [{ kind: 'label', issue: epic, label: APPROVED_LABEL },
      ...releasable(tickets).map((r) => ({ kind: 'label', issue: r.number, label: r.label }))]
  }
  if (v === 'no-go' && route(decision, legacyRounds(comments)) === 'revise') {
    return [{ kind: 'dispatch', issue: epic, workflow: 'ticket-revise.yml', inputs: { epic: String(epic) } }]
  }
  return [{ kind: 'block', issue: epic }]
}

/** PURE. The epic's state after this review, in the shape nextAction() reads. */
export function rollingState({ subject = '', labels = [], decision, comments = [], subIssues = [], steps = null }) {
  const plan = rollingPlanState({ subject, labels, decision, comments, steps })
  const per = new Map((decision?.tickets || []).map((t) => [t.number, t]))
  const runnable = new Set(releasable(subIssues.filter((s) => s.state !== 'closed')).map((r) => r.number))
  const tickets = {}
  for (const s of subIssues) tickets[s.number] = rollingTicketState(s, per.get(s.number), { comments, runnable })
  return { rolling: true, plan, steps, tickets }
}

/**
 * The plan's row: this review's plan verdict, else approved (or no step list) → go. "Approved" needs
 * the `steps:approved` label AND the newest bot step-list verdict to be a go: a label left behind by
 * a later no-go must never let a ticket start (#3846 review).
 */
function rollingPlanState({ subject, labels, decision, comments, steps }) {
  const planNow = subject === 'plan' ? decision?.plan?.verdict || null : null
  const lastPlan = verdictCommentsFor(comments, 'plan').at(-1)
  const approved = names(labels).includes(STEPS_APPROVED_LABEL) && (lastPlan === undefined || lastPlan.includes(PLAN_GO_MARKER))
  // A step-list comment that is there but cannot be read holds the epic (never "no step list" → go).
  const stepsError = steps ? null : readSteps(comments).error
  return {
    stepsError,
    verdict: planNow || (approved || !steps ? 'go' : null),
    round: countRounds(comments, 'plan'),
    // A plan go in THIS review is newer than any plan-wrong comment already on the epic.
    wrong: planNow === 'go' ? false : planWrongOnRecord(comments),
  }
}

/** One sub-issue's row. `t` = this review's verdict for it (undefined if it was not graded). */
function rollingTicketState(s, t, { comments, runnable }) {
  const started = names(s.labels).some((l) => PIPELINE_LABELS.includes(l))
  // Only tickets this review graded carry a verdict; others are reported, never touched.
  return {
    state: s.state === 'closed' ? 'closed' : 'open',
    verdict: t ? t.verdict : (started ? 'go' : null),
    round: countRounds(comments, String(s.number)),
    // A ticket still Blocked-by an earlier one is released by the wave scheduler, not here.
    started: started || (t?.verdict === 'go' && !runnable.has(s.number)),
    label: parsePipelineBlock(s.body || '').dispatch || 'work-this',
    step: stepOf(s.body),
  }
}

/** PURE. Verdict → handoff lines (see the header). */
export function reviewActions({ epic, subject = '', labels = [], decision, comments = [], tickets = [], subIssues = [], steps = null }) {
  if (!names(labels).includes(ROLLING_LABEL)) return legacyActions({ epic, decision, comments, tickets })
  const subs = subIssues.length ? subIssues : tickets
  const state = rollingState({ subject, labels, decision, comments, subIssues: subs, steps })
  const out = []
  if (subject === 'plan' && decision?.plan?.verdict === 'go') out.push({ kind: 'label', issue: epic, label: STEPS_APPROVED_LABEL })
  const ctx = {
    epic, steps, hold: splitVerdict(decision, steps, subs).hold,
    approvedLabel: names(labels).includes(STEPS_APPROVED_LABEL),
    graded: new Set((decision?.tickets || []).map((t) => t.number)),
  }
  // A `hold` line becomes ONE status:blocked on the epic (the first time) plus a note.
  let blocked = false
  for (const line of nextAction(state).flatMap((a) => linesFor(a, ctx))) {
    if (line.kind !== 'hold') { out.push(line); continue }
    if (!blocked) out.push({ kind: 'block', issue: epic })
    blocked = true
    out.push({ kind: 'note', text: line.text })
  }
  return out
}

/** One nextAction() row → its handoff lines (`hold` = block the epic with this note). */
function linesFor(a, ctx) {
  if (a.type === 'plan-review' || a.target === 'plan') return planLines(a, ctx)
  if (a.type === 'write-ticket' || a.type === 'done') return stepLines(a, ctx)
  return ticketLines(a, ctx)
}

function planLines(a, { epic, approvedLabel }) {
  if (a.type === 'plan-review') return [{ kind: 'note', text: `The step list has no approved review yet — run ${reviewCmd(epic, 'plan')} first.` }]
  // Any step-list verdict other than go takes `steps:approved` off, so no ticket starts on a stale label.
  if (a.reason !== 'plan-wrong') {
    const why = a.reason === 'unreadable' ? `the step-list comment cannot be read: ${a.detail}` : a.reason
    return [...(approvedLabel ? [{ kind: 'unlabel', issue: epic, label: STEPS_APPROVED_LABEL }] : []),
      { kind: 'hold', text: `The step list was not approved (${why}). Fix the step-list comment by hand, then run ${reviewCmd(epic, 'plan')}.` }]
  }
  return [{ kind: 'unlabel', issue: epic, label: STEPS_APPROVED_LABEL },
    { kind: 'hold', text: `The step list is wrong. Fix the step-list comment by hand, then run ${reviewCmd(epic, 'plan')}. Tickets already started keep running.` }]
}

/** Only tickets this review graded are touched; others are reported by a later review. */
function ticketLines(a, { epic, graded, hold }) {
  const n = a.n ?? a.target
  if (!graded.has(n)) return []
  if (a.type === 'start') return hold.includes(n) ? [] : [{ kind: 'label', issue: n, label: a.label }]
  if (a.type === 'park') {
    const on = a.waitingOn.map((w) => (w ? `#${w}` : 'a step with no ticket yet')).join(', ')
    return [{ kind: 'note', text: `#${n} is go but parked until ${on} closes — then run ${reviewCmd(epic, n)} to start it.` }]
  }
  if (a.type === 'revise') return [{ kind: 'dispatch', issue: epic, workflow: 'ticket-revise.yml', inputs: { epic: String(epic), subject: String(n) } }]
  if (a.type === 'hold') return [{ kind: 'hold', text: `#${n} is held (${a.reason === 'round-cap' ? 'third review round' : 'needs your answer'}); tickets that are go are not affected.` }]
  return []
}

function stepLines(a, { epic, steps }) {
  if (a.type === 'done') return [{ kind: 'note', text: 'Every step has a closed ticket — the epic is finished.' }]
  const title = steps?.[a.step]?.title || `step ${a.step}`
  return [{ kind: 'note', text: `Step ${a.step} (${title}) is ready — write its ticket by hand with \`<!-- pipeline: epic=${epic} step=${a.step} -->\` in the body, then run ${reviewCmd(epic, '<ticket>')}.` }]
}

/**
 * PURE. Before the reviewer runs (ticket-review.yml's gather step): may this review go ahead?
 *   → { go: true } · { held: true, lines } (hold the epic, run no reviewer) · { error }
 * `subject=plan` with a step-list comment that is there but cannot be read ends like the ticket path:
 * the epic holds with the reason (readSteps → reviewActions), never "no open sub-issues" (#3846 review).
 */
export function gatherGate({ epic, subject = '', labels = [], comments = [], tickets = [], steps = null }) {
  if (subject === 'plan' && !steps && readSteps(comments).error) {
    // A bot step-list comment only exists on a rolling epic, so read the epic as one here.
    const rolling = names(labels).includes(ROLLING_LABEL) ? names(labels) : [...names(labels), ROLLING_LABEL]
    return { held: true, lines: reviewActions({ epic, subject, labels: rolling, decision: null, comments, tickets, subIssues: tickets, steps: null }) }
  }
  if ((subject === 'plan' && steps?.length) || tickets.length) return { go: true }
  return { error: `epic #${epic} has no open sub-issues to review` }
}

/** PURE. The one hold comment for a gate hold: provenance + the notes (the field that is wrong). */
export function gateComment(lines) {
  const notes = lines.filter((l) => l.kind === 'note').map((l) => `- ${l.text}`).join('\n')
  return `<!-- pipeline-note -->\n<!-- ticket-review-held:steps-unreadable -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _ticket review (#3846)_\n\n` +
    `🔴 **The step list cannot be read** — the review did not run and no ticket started.\n**Needs:** action — fix the step-list comment.\n\n${notes}\n`
}

/** CLI `gather`: hold via gh (block / unlabel + one comment) and set `held=true`, or fail loud on nothing to review. */
function runGather(argv, subject) {
  const [commentsF, epicF, ticketsF, stepsF] = argv
  const json = (f) => JSON.parse(readFileSync(f, 'utf8'))
  const epic = json(epicF)
  const steps = stepsF && existsSync(stepsF) && readFileSync(stepsF, 'utf8').trim() ? json(stepsF) : null
  const g = gatherGate({ epic: epic.number, subject, labels: epic.labels, comments: json(commentsF), tickets: json(ticketsF), steps })
  if (g.error) { console.log(`::error::${g.error}`); process.exit(1) }
  if (!g.held) return
  const gh = (...a) => execFileSync('gh', a, { stdio: ['ignore', 'inherit', 'inherit'] })
  for (const l of g.lines) {
    if (l.kind === 'unlabel') { try { gh('issue', 'edit', String(l.issue), '--remove-label', l.label) } catch { /* not carried: fine */ } }
    if (l.kind === 'block') gh('issue', 'edit', String(l.issue), '--add-label', 'status:blocked')
  }
  gh('issue', 'comment', String(epic.number), '--body', gateComment(g.lines))
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'held=true\n')
  console.log(`held epic #${epic.number}: the step list cannot be read`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const si = argv.indexOf('--subject')
  const subject = si >= 0 ? String(argv.splice(si, 2)[1] || '').trim() : ''
  if (argv[0] === 'gather') { runGather(argv.slice(1), subject); process.exit(0) }
  const [decisionF, commentsF, epicF, subsF, stepsF] = argv
  if (!subsF) { console.error('usage: ticket-review-actions.mjs <decision.json> <comments.json> <epic.json> <subs.json> [steps.json] [--subject S]'); process.exit(2) }
  const json = (f) => JSON.parse(readFileSync(f, 'utf8'))
  const epic = json(epicF)
  const subIssues = json(subsF)
  const steps = stepsF && existsSync(stepsF) && readFileSync(stepsF, 'utf8').trim() ? json(stepsF) : null
  const tickets = subIssues.filter((s) => s.state !== 'closed')
  for (const line of reviewActions({ epic: epic.number, subject, labels: epic.labels, decision: json(decisionF), comments: json(commentsF), tickets, subIssues, steps })) {
    console.log(JSON.stringify(line))
  }
}
