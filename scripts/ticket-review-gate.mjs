#!/usr/bin/env node
// ticket-review-gate.mjs — review a chat-made ticket before it is built (#4456). PURE core + a CLI.
//
// label-router.yml runs this on every `work-this` BEFORE its Dispatch step. A ticket a chat wrote
// (not made by the pipeline's split) under an epic, with no ticket-review go for itself, is not built
// yet: the gate takes `work-this` off (the claim), starts `ticket-review.yml -f subject=<n>` for that
// ticket alone and notes it on the ticket. The review's go puts `work-this` back (gateRelease, called
// from ticket-review-actions.mjs); the router then sees the go verdict and routes as today.
//
// gateDecision rules, in order (1–3 keep today's roads first; the gate is 4–9):
//   1. actor may not drive the pipeline → proceed (the Dispatch bot-guard rejects it, as today)
//   2. the ticket is an epic → proceed (the splitter road; no child review)
//   3. the ticket carries plan:approved → proceed
//   4. no parent, or a parent without `epic` → proceed
//   5. pipeline-made (a pipeline block AND authored by the harness bot) → proceed
//   6. the latest bot verdict for this ticket is a go → proceed
//   7. `work-this` is gone (a second event after the first run took it) → skip
//   8. a ticket-review run for this ticket is not finished → skip
//   9. otherwise → review
//
// Fail open: an error before the claim (work-this taken off) lets the ticket start as on main
// (a ::warning::, no held, exit 0). After it: if the review was dispatched and only the note failed,
// held=true + a ::warning::; if the dispatch failed, work-this goes back through the hand-off script
// and held=true (the fresh label event starts the ticket, not this run) — exit non-zero only when
// that hand-off fails too, with an ::error:: naming the ticket.
//
//   node scripts/ticket-review-gate.mjs <issue>
//     env ACTOR, GH_TOKEN, HANDOFF_FALLBACK_TOKEN, GITHUB_REPOSITORY; writes held=true to $GITHUB_OUTPUT
//     on review and skip (the router's Dispatch step then does not run).
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { botActorAllowed } from './pipeline-loop-guard.mjs'
import { parsePipelineBlock } from './pipeline-context.mjs'
import { parseBlockers, isDispatched } from './wave-gate.mjs'
import { isHarnessBot, verdictCommentsFor } from './lib/epic-steps.mjs'

export const TRIGGER = 'work-this'
const PROVENANCE = '> 🤖 **pi.dev harness** · agent pipeline (CI) · _ticket review gate (#4456)_'
const names = (ls) => (ls || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)

/** The run title ticket-review.yml gives a review of one ticket (pinned to handoff.mjs). */
export const reviewRunTitle = (epic, n) => `ticket-review #${epic} · ${n}`

/** PURE. Was this ticket made by the pipeline's split? A block AND the harness bot as author. */
export function pipelineMade(ticket) {
  const block = parsePipelineBlock(ticket?.body || '')
  return Object.values(block).some((v) => v !== null && v !== undefined) && isHarnessBot({ user: ticket?.author })
}

/** PURE. Is the newest bot verdict that graded ticket n a go (its `#### ✅ #n` row)? */
export function hasGoVerdict(epicComments, n) {
  const last = verdictCommentsFor(epicComments || [], String(n)).at(-1)
  return !!last && new RegExp(`^####\\s+✅\\s+#${n}\\b`, 'mu').test(last)
}

/** PURE. → { action: 'proceed'|'review'|'skip', reason } (rules in the header). */
export function gateDecision({ ticket, parent = null, epicComments = [], runs = [], actorAllowed = true }) {
  const labels = names(ticket?.labels)
  if (!actorAllowed) return { action: 'proceed', reason: 'actor-not-allowed' }
  if (labels.includes('epic')) return { action: 'proceed', reason: 'is-epic' }
  if (labels.includes('plan:approved')) return { action: 'proceed', reason: 'plan-approved' }
  if (!parent || !names(parent.labels).includes('epic')) return { action: 'proceed', reason: 'no-parent-epic' }
  if (pipelineMade(ticket)) return { action: 'proceed', reason: 'pipeline-made' }
  if (hasGoVerdict(epicComments, ticket.number)) return { action: 'proceed', reason: 'review-go' }
  if (!labels.includes(TRIGGER)) return { action: 'skip', reason: 'no-trigger-label' }
  const title = reviewRunTitle(parent.number, ticket.number)
  if ((runs || []).some((r) => r.display_title === title && r.status !== 'completed')) return { action: 'skip', reason: 'review-running' }
  return { action: 'review', reason: 'no-review-go' }
}

const note = (text) => `<!-- pipeline-note -->\n${PROVENANCE}\n\n${text}`

/**
 * PURE. The gate's own release after a review of ONE ticket on an epic without `tickets:rolling`.
 * `blockerStates` = { <n>: 'open'|'closed' } for every number in the ticket's `Blocked-by:`.
 * A go never ends silent: it re-adds `work-this` on the ticket or posts a comment on it.
 */
export function gateRelease({ ticket, verdict, blockerStates = {} }) {
  if (!ticket || verdict !== 'go') return []
  const n = ticket.number
  if (isDispatched(names(ticket.labels))) return [{ kind: 'comment', issue: n, text: note('✅ Ticket review approved — already started.') }]
  const waiting = parseBlockers(ticket.body).filter((b) => blockerStates[b] !== 'closed')
  if (!waiting.length) return [{ kind: 'unlabel', issue: n, label: TRIGGER }, { kind: 'label', issue: n, label: TRIGGER }]
  const list = waiting.map((b) => `#${b}`).join(', ')
  return [{ kind: 'comment', issue: n, text: note(`✅ Ticket review approved; waits for ${list} — it starts by itself when ${waiting.length > 1 ? 'they close' : 'it closes'}.`) }]
}

const lines = (out) => String(out).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
const is404 = (e) => /HTTP 404|Not Found|No parent issue found/.test(String(e?.stderr || '') + String(e?.message || ''))

// The reads + the decision. Each read happens only when the decision needs it.
function decide(n, repo, deps) {
  const { gh, env } = deps
  const raw = JSON.parse(gh(['api', `repos/${repo}/issues/${n}`, '--jq', '{number, body, labels: [.labels[].name], user: {login: .user.login, type: .user.type}}']))
  const ticket = { number: n, labels: raw.labels, body: raw.body || '', author: raw.user }
  let parent = null
  try { parent = JSON.parse(gh(['api', `repos/${repo}/issues/${n}/parent`, '--jq', '{number, labels: [.labels[].name]}'])) } catch (e) { if (!is404(e)) throw e }
  const facts = { ticket, parent, epicComments: [], actorAllowed: botActorAllowed(env.ACTOR) }
  // Rules 1–5 need only the ticket and its parent; with no comments a 'proceed' can only come from
  // them, so the epic's comments are read only when the decision reaches rule 6.
  let d = gateDecision({ ...facts, runs: [] })
  if (d.action !== 'proceed') {
    facts.epicComments = lines(gh(['api', '--paginate', `repos/${repo}/issues/${parent.number}/comments?per_page=100`, '--jq', '.[] | {body, user: {login: .user.login, type: .user.type}}']))
    d = gateDecision({ ...facts, runs: [] })
  }
  if (d.action === 'review') {
    const runs = lines(gh(['api', `repos/${repo}/actions/workflows/ticket-review.yml/runs?event=workflow_dispatch&per_page=50`, '--jq', '.workflow_runs[] | {display_title, status}']))
    d = gateDecision({ ...facts, runs })
  }
  return { d, parent }
}

const firstLine = (e) => String(e?.stderr || e?.message || e).trim().split('\n')[0]

// Fail open: a fault in the gate never stops a ticket from starting (no held → Dispatch runs).
// After the claim, `dispatched` tells the two faults apart: the review started and only the note
// failed (the ticket is under review — hold, warn), or the dispatch itself failed (restore the label).
function failOpen(e, n, claimed, dispatched, deps) {
  const msg = firstLine(e)
  if (!claimed) {
    deps.log(`::warning::ticket-review gate #${n}: error before the claim, the ticket starts as usual — ${msg}`)
    deps.log(`ticket-review gate #${n}: proceed (gate-error)`)
    return { action: 'proceed', reason: 'gate-error', exitCode: 0 }
  }
  if (dispatched) {
    deps.output('held=true')
    deps.log(`::warning::ticket-review gate #${n}: the review started but the note on the ticket failed — ${msg}`)
    deps.log(`ticket-review gate #${n}: review (note-error)`)
    return { action: 'review', reason: 'note-error', exitCode: 0 }
  }
  return restoreLabel(n, msg, deps)
}

// The dispatch failed after the claim: put work-this back through the hand-off script (saved and
// replayed by the sweep if the allowance ran out). held=true: the fresh label event starts it, not this run.
function restoreLabel(n, msg, deps) {
  deps.log(`::warning::ticket-review gate #${n}: error after taking ${TRIGGER} off, putting it back — ${msg}`)
  try {
    deps.handoff({ kind: 'label', issue: n, label: TRIGGER })
  } catch (e2) {
    deps.log(`::error::ticket-review gate: ticket #${n} has lost ${TRIGGER} and has no review — put ${TRIGGER} back on #${n} by hand (${firstLine(e2)})`)
    deps.log(`ticket-review gate #${n}: lost-label (gate-error)`)
    return { action: 'lost-label', reason: 'gate-error', exitCode: 1 }
  }
  deps.output('held=true')
  deps.log(`ticket-review gate #${n}: restored (gate-error)`)
  return { action: 'restored', reason: 'gate-error', exitCode: 0 }
}

/** CLI core. `deps` = { gh(args) → stdout (throws with .stderr), handoff(step), output(line), log(msg), env }.
 *  → the decision plus `exitCode` (0 unless the gate took `work-this` off and could not put it back). */
export async function runGate(issue, deps) {
  const { gh } = deps
  const repo = deps.env.GITHUB_REPOSITORY
  const n = Number(issue)
  let claimed = false
  let dispatched = false
  const drop = () => {
    try { gh(['api', '-X', 'DELETE', `repos/${repo}/issues/${n}/labels/${TRIGGER}`]) } catch (e) { if (is404(e)) return false; throw e }
    claimed = true
    return true
  }
  let d
  try {
    const r = decide(n, repo, deps)
    d = r.d
    if (d.action === 'review') {
      // The claim: only the run whose DELETE succeeds starts the review; a second event gets 404.
      if (!drop()) d = { action: 'skip', reason: 'claimed-by-another-run' }
      else {
        deps.handoff({ kind: 'dispatch', issue: n, workflow: 'ticket-review.yml', inputs: { epic: String(r.parent.number), subject: String(n) } })
        dispatched = true
        gh(['issue', 'comment', String(n), '--repo', repo, '--body', note(`🔎 Ticket review first (epic #${r.parent.number}) — this ticket starts by itself when the review says go.`)])
      }
    } else if (d.reason === 'review-running') drop() // so the running review's go re-add fires a fresh event
  } catch (e) {
    return failOpen(e, n, claimed, dispatched, deps)
  }
  if (d.action !== 'proceed') deps.output('held=true')
  deps.log(`ticket-review gate #${n}: ${d.action} (${d.reason})`)
  return { ...d, exitCode: 0 }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const issue = process.argv[2]
  if (!/^\d+$/.test(String(issue || ''))) { console.error('usage: ticket-review-gate.mjs <issue>'); process.exit(2) }
  const here = (p) => fileURLToPath(new URL(p, import.meta.url))
  const r = await runGate(issue, {
    env: process.env,
    gh: (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }),
    handoff: (step) => execFileSync('node', [here('./handoff-exec.mjs'), step.kind, JSON.stringify(step)], { stdio: ['ignore', 'inherit', 'inherit'] }),
    output: (line) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`) },
    log: (m) => console.log(m),
  })
  process.exit(r.exitCode)
}
