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
//   • a no-go ticket → ticket-revise.yml for THAT ticket (`subject=<n>`), 3 rounds per ticket, then hold;
//   • needs-owner → hold; a plan no-go / needs-owner → hold (the step list is fixed by hand);
//   • plan-wrong (a ticket verdict, or a newer bot `<!-- epic-plan-wrong -->` comment) → remove
//     `steps:approved` + hold. Nothing is dispatched to the decomposer; started tickets keep running.
//   • a step whose blockers' tickets are closed and that has no ticket → a NOTE only: the
//     orchestrator writes that ticket by hand (owner decision 2026-11-12 12:54).
//
//   node scripts/ticket-review-actions.mjs <decision.json> <comments.json> <epic.json> <subs.json> [steps.json] [--subject S]
//   epic.json = { number, labels: [names] } · subs.json = every sub-issue { number, state, body, labels }
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { releasable, APPROVED_LABEL } from './lib/ticket-verdict.mjs'
import { countRounds as legacyRounds, route } from './ticket-revise.mjs'
import { parsePipelineBlock } from './pipeline-context.mjs'
import {
  ROLLING_LABEL, STEPS_APPROVED_LABEL, countRounds, splitVerdict, nextAction, planWrongOnRecord, stepOf,
} from './lib/epic-steps.mjs'

const TRIGGERS = ['work-this', 'delegate-pi', 'delegate']
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
  const planNow = subject === 'plan' ? decision?.plan?.verdict || null : null
  const approved = names(labels).includes(STEPS_APPROVED_LABEL)
  const plan = {
    verdict: planNow || (approved || !steps ? 'go' : null),
    round: countRounds(comments, 'plan'),
    // A plan go in THIS review is newer than any plan-wrong comment already on the epic.
    wrong: planNow === 'go' ? false : planWrongOnRecord(comments),
  }
  const per = new Map((decision?.tickets || []).map((t) => [t.number, t]))
  const runnable = new Set(releasable(subIssues.filter((s) => s.state !== 'closed')).map((r) => r.number))
  const tickets = {}
  for (const s of subIssues) {
    const t = per.get(s.number)
    const started = names(s.labels).some((l) => TRIGGERS.includes(l))
    // Only tickets this review graded carry a verdict; others are reported, never touched.
    tickets[s.number] = {
      state: s.state === 'closed' ? 'closed' : 'open',
      verdict: t ? t.verdict : (started ? 'go' : null),
      round: countRounds(comments, String(s.number)),
      // A ticket still Blocked-by an earlier one is released by the wave scheduler, not here.
      started: started || (t?.verdict === 'go' && !runnable.has(s.number)),
      label: parsePipelineBlock(s.body || '').dispatch || 'work-this',
      step: stepOf(s.body),
    }
  }
  return { rolling: true, plan, steps, tickets }
}

/** PURE. Verdict → handoff lines (see the header). */
// fallow-ignore-next-line complexity -- maps each nextAction() row to its handoff line; covered by ticket-review-actions.test.mjs (#3846)
export function reviewActions({ epic, subject = '', labels = [], decision, comments = [], tickets = [], subIssues = [], steps = null }) {
  if (!names(labels).includes(ROLLING_LABEL)) return legacyActions({ epic, decision, comments, tickets })
  const subs = subIssues.length ? subIssues : tickets
  const state = rollingState({ subject, labels, decision, comments, subIssues: subs, steps })
  const out = []
  if (subject === 'plan' && decision?.plan?.verdict === 'go') out.push({ kind: 'label', issue: epic, label: STEPS_APPROVED_LABEL })
  const { hold } = splitVerdict(decision, steps, subs)
  const graded = new Set((decision?.tickets || []).map((t) => t.number))
  let blocked = false
  const block = (text) => { if (!blocked) out.push({ kind: 'block', issue: epic }); blocked = true; out.push({ kind: 'note', text }) }
  const titleOf = (k) => steps?.[k]?.title || `step ${k}`
  for (const a of nextAction(state)) {
    if (a.type === 'hold' && a.target === 'plan' && a.reason === 'plan-wrong') {
      out.push({ kind: 'unlabel', issue: epic, label: STEPS_APPROVED_LABEL })
      block(`The step list is wrong. Fix the step-list comment by hand, then run ${reviewCmd(epic, 'plan')}. Tickets already started keep running.`)
    } else if (a.type === 'hold' && a.target === 'plan') {
      block(`The step list was not approved (${a.reason}). Fix the step-list comment by hand, then run ${reviewCmd(epic, 'plan')}.`)
    } else if (a.type === 'plan-review') {
      out.push({ kind: 'note', text: `The step list has no approved review yet — run ${reviewCmd(epic, 'plan')} first.` })
    } else if (a.type === 'start' && graded.has(a.n) && !hold.includes(a.n)) {
      out.push({ kind: 'label', issue: a.n, label: a.label })
    } else if (a.type === 'revise' && graded.has(a.n)) {
      out.push({ kind: 'dispatch', issue: epic, workflow: 'ticket-revise.yml', inputs: { epic: String(epic), subject: String(a.n) } })
    } else if (a.type === 'hold' && graded.has(a.target)) {
      block(`#${a.target} is held (${a.reason === 'round-cap' ? 'third review round' : 'needs your answer'}); tickets that are go are not affected.`)
    } else if (a.type === 'write-ticket') {
      out.push({ kind: 'note', text: `Step ${a.step} (${titleOf(a.step)}) is ready — write its ticket by hand with \`<!-- pipeline: epic=${epic} step=${a.step} -->\` in the body, then run ${reviewCmd(epic, '<ticket>')}.` })
    } else if (a.type === 'done') {
      out.push({ kind: 'note', text: 'Every step has a closed ticket — the epic is finished.' })
    }
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const si = argv.indexOf('--subject')
  const subject = si >= 0 ? String(argv.splice(si, 2)[1] || '').trim() : ''
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
