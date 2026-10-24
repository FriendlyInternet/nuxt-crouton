#!/usr/bin/env node
// pipeline-loop-guard.mjs — WS4 of epic #1685: the loop-guards that make the event-driven,
// label-handoff pipeline (WS3) safe to turn on. Pure + unit-tested (pipeline-loop-guard.test.mjs)
// so the invariants that broke at #457 can't silently regress when the decomposer starts
// emitting labels.
//
// THE FOUR INVARIANTS (each has a function here; the workflows / the decomposer wire to them):
//
//  1. BOT-ACTOR GUARD (#457/#1004) — a label applied from INSIDE a run must be actored by the
//     Harness App (`nuxt-harness[bot]`, an allowed + cascading bot). Any OTHER `*[bot]` actor —
//     `claude[bot]`, `github-actions[bot]` — is REJECTED, so a worker's own label change can't
//     re-drive the pipeline as a masquerading bot. Humans always pass (they ARE the entry point).
//     `work-issue-pidev.yml` / `decompose-on-issue-pidev.yml` call the `bot-guard` CLI below.
//
//  2. EXACT-LABEL GATING (#535) — a job fires ONLY on the exact trigger label freshly applied
//     (`work-this` for the worker, `delegate-pi`/`delegate-hard` for the decomposer), never on a
//     worker's incidental `status:in-progress` add. This mirrors each workflow's job `if:` so the
//     re-fire loop is closed. (`jobShouldFire` is the executable spec of that `if:`.)
//
//  3. DEPTH / FAN-OUT CAPS (#249) — enforced ACROSS runs, not by an in-process counter: `depth`
//     is read from the WS2 pipeline block (#1695) on the issue. At `depth >= MAX_DEPTH` the
//     decomposer must LABEL the issue a leaf (`work-this`), never split again — otherwise a
//     `delegate-pi` child could beget a `delegate-pi` child forever. `MAX_CHILDREN` bounds one
//     split. `withinCaps` is the decision the decomposer's label choice maps to.
//
//  4. CLAIM GUARD (#1890) — an issue that is already closed, already has an open/merged PR, or
//     carries a fresh `status:in-progress` must NOT be worked again. Five workflows stamped that
//     label and none read it, which cost three duplicate builds in one day (#1478/#1622/#1889).
//     `decideClaim` is the read side; the workers call the `claim-guard` CLI below.
//
// These MUST stay in lockstep with the caps in `.claude/agents/task-decomposer.md` and the job
// `if:` blocks in the two `*-pidev.yml` workflows. This file is the single tested source.

import { pathToFileURL } from 'node:url'
import { appendFileSync, readFileSync } from 'node:fs'

export const ALLOWED_BOT = 'nuxt-harness[bot]'
export const MAX_DEPTH = 3
export const MAX_CHILDREN = 6
// The labels that legitimately DRIVE a fresh pipeline run (a human or the App may apply them).
export const WORKER_TRIGGER = 'work-this'
export const DECOMPOSE_TRIGGERS = ['delegate-pi', 'delegate-hard']

/**
 * INVARIANT 1 — may `actor` drive the pipeline?
 * A human (no `[bot]` suffix) always may. A bot may ONLY if it is the allowed Harness App.
 * This is the #457 loop-break: `claude[bot]`/`github-actions[bot]` re-firing off a worker's
 * own label change is refused.
 */
export function botActorAllowed(actor, allowed = ALLOWED_BOT) {
  if (!actor || typeof actor !== 'string') return false
  if (!actor.endsWith('[bot]')) return true // a human
  return actor === allowed
}

/**
 * INVARIANT 2 — should the job fire for this event? Executable mirror of the workflow `if:`.
 *   { eventName, action, labelName, trigger }
 * `trigger` is a single label or an array of labels the workflow fires on. `workflow_dispatch`
 * always fires (a human explicitly asked). An `issues`/`labeled` event fires ONLY when the
 * freshly-applied label is exactly one of the triggers — so `status:in-progress` (added by a
 * worker mid-run) does NOT re-fire.
 */
export function jobShouldFire({ eventName, action, labelName, trigger } = {}) {
  if (eventName === 'workflow_dispatch') return true
  if (eventName !== 'issues' || action !== 'labeled') return false
  const triggers = Array.isArray(trigger) ? trigger : [trigger]
  return triggers.includes(labelName)
}

/**
 * INVARIANT 3 — given the current depth (from the WS2 block) and a proposed split size, what
 * should the decomposer do? Returns `{ action, reason }` where action is:
 *   • 'leaf'  → label the issue `work-this` (build it; do not split). Forced at the depth cap.
 *   • 'split' → create children and label each. Only when below the depth cap.
 * `childCount` (optional) is validated against MAX_CHILDREN when splitting.
 */
export function decideSplit({ depth = 0, isLeaf = false, childCount = 0,
  maxDepth = MAX_DEPTH, maxChildren = MAX_CHILDREN } = {}) {
  const d = Number.isFinite(depth) ? depth : 0
  if (d >= maxDepth) return { action: 'leaf', reason: `depth ${d} >= MAX_DEPTH ${maxDepth} — forced leaf` }
  if (isLeaf) return { action: 'leaf', reason: 'passes the LEAF TEST' }
  if (childCount > maxChildren) {
    return { action: 'split', reason: `over MAX_CHILDREN (${childCount} > ${maxChildren}) — slices too thin, merge` , overCap: true }
  }
  return { action: 'split', reason: `depth ${d} < ${maxDepth} — split` }
}

/** The label a child should receive given its own leaf-ness and depth. */
export function labelForChild({ depth = 0, isLeaf = false, maxDepth = MAX_DEPTH } = {}) {
  return decideSplit({ depth, isLeaf, maxDepth }).action === 'leaf' ? WORKER_TRIGGER : 'delegate-pi'
}

/**
 * INVARIANT 4 — is this issue already claimed? (#1890)
 *
 * Before #1890 the claim signal was WRITE-ONLY: five workflows stamped `status:in-progress`
 * and nothing read it, so two runners could build the same issue. It cost three duplicate
 * builds in one day — #1478 (started 8 min after #1473 closed the issue), #1622, #1889.
 *
 * Signals are ranked by how much they can be trusted, strongest first:
 *   1. the issue is CLOSED            — timestamp-free, unambiguous: the work is over
 *   2. a MERGED PR references it      — timestamp-free: the work already landed
 *   3. an OPEN PR references it       — timestamp-free: another runner is on it
 *   4. `status:in-progress` age < TTL — weakest; needs a clock, and a crashed run leaves it
 *
 * (4) is deliberately the last resort and TTL'd. A crashed run must not wedge an issue
 * forever, so a stale stamp PROCEEDS (saying so), and an unparseable timestamp fails OPEN —
 * the three strong signals still gate. A closed-but-unmerged PR does not claim anything: a
 * rejected attempt should free the issue, not lock it.
 *
 * MERGED MEANS MERGED TO THE DEFAULT BRANCH (#2027). Our topology is `work-<n>` →
 * `epic/<n>-<slug>` → `main`, so a sub-PR merging into its EPIC branch is mid-flight, not
 * done. Reading it as "landed" refuses every re-dispatch from then on: it wedged #1791
 * permanently after PR #1987 merged into `epic/1791-…`, and would wedge every issue in the
 * epic topology the moment its first sub-PR merged. A PR whose `baseRef` is unknown still
 * counts as landed — the caller may not have fetched it, and the pre-#2027 behaviour is the
 * safer default when we cannot tell.
 */
export const CLAIM_TTL_MINUTES = 90
export const DEFAULT_BRANCH = 'main'

export function decideClaim({
  issueState = 'open',
  linkedPRs = [],
  inProgressSince = null,
  now = null,
  ttlMinutes = CLAIM_TTL_MINUTES,
  defaultBranch = DEFAULT_BRANCH,
  self = {},
} = {}) {
  if (issueState === 'closed') {
    return { action: 'refuse', reason: 'the issue is already closed — its work is done or was dropped' }
  }

  // A PR of our own (a re-dispatch onto the same branch) is not a competing claim.
  const others = (linkedPRs || []).filter((pr) => pr && pr.number !== self?.pr)
  const merged = others.find((pr) => pr.merged && (pr.baseRef == null || pr.baseRef === defaultBranch))
  if (merged) {
    return { action: 'refuse', claimedBy: merged.number, reason: `PR #${merged.number} already merged for this issue` }
  }
  const open = others.find((pr) => pr.state === 'open')
  if (open) {
    return { action: 'refuse', claimedBy: open.number, reason: `PR #${open.number} is already open for this issue` }
  }

  const since = inProgressSince ? Date.parse(inProgressSince) : NaN
  const at = now ? Date.parse(now) : NaN
  if (Number.isFinite(since) && Number.isFinite(at)) {
    const ageMin = (at - since) / 60_000
    if (ageMin < ttlMinutes) {
      return { action: 'refuse', reason: `status:in-progress was stamped ${Math.round(ageMin)}m ago (< ${ttlMinutes}m) — another run holds it` }
    }
    return { action: 'proceed', reason: `status:in-progress is stale (${Math.round(ageMin)}m > ${ttlMinutes}m) — treating the prior run as dead` }
  }

  return { action: 'proceed', reason: 'no claim found' }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
//   node scripts/pipeline-loop-guard.mjs bot-guard <actor> [<allowed>]
//     → exit 0 if allowed, exit 1 (with an ::error::) if a disallowed bot. Used as the
//       workflow's Bot-actor guard step so the SHIPPED guard is the unit-tested function.
//   node scripts/pipeline-loop-guard.mjs claim-guard < facts.json
//     → facts.json is { issueState, linkedPRs, inProgressSince, now, self } gathered by the
//       workflow's API step. Exit 0 to proceed; exit 1 (with an ::error::) when the issue is
//       already claimed, so the run stops before spending a build on duplicate work (#1890).
/**
 * Publish a refusal reason as a step output so the workflow can say WHY on the issue (#2027).
 * Without it the owner sees only the artifact-gate's generic alarm and has to open step 6 of a
 * run log to learn the run stopped on purpose. Reasons are single-line by construction; strip
 * newlines anyway rather than corrupt the output file. Diagnostics only — never throws.
 */
function publishClaimReason(reason) {
  if (!process.env.GITHUB_OUTPUT) return
  try {
    appendFileSync(process.env.GITHUB_OUTPUT, `claim_reason=${String(reason).replace(/[\r\n]+/g, ' ')}\n`)
  } catch { /* the guard's verdict still stands; only the explanation is lost */ }
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'claim-guard') {
    let facts = {}
    try {
      const raw = readFileSync(0, 'utf8').trim()
      facts = raw ? JSON.parse(raw) : {}
    } catch (err) {
      // Fail OPEN on unreadable facts: a gather glitch must not wedge the pipeline. The
      // duplicate-work risk is real but bounded; a permanently-blocked worker is worse.
      console.log(`::warning::claim-guard could not read its facts (${err.message}) — proceeding.`)
      return
    }
    const verdict = decideClaim(facts)
    if (verdict.action === 'proceed') {
      console.log(`Claim guard OK — ${verdict.reason}.`)
      return
    }
    publishClaimReason(verdict.reason)
    console.log(`::error::Claim guard: refusing to work this issue — ${verdict.reason}. This is a deliberate stop, not a build failure (#1890).`)
    process.exit(1)
  }
  if (cmd === 'bot-guard') {
    const actor = rest[0]
    const allowed = rest[1] || ALLOWED_BOT
    if (botActorAllowed(actor, allowed)) {
      console.log(`Bot-actor guard OK (actor: ${actor}).`)
      return
    }
    console.log(`::error::Bot-actor guard: '${actor}' may not drive the pi pipeline (only ${allowed}). Refusing to run.`)
    process.exit(1)
  }
  console.error('usage: node scripts/pipeline-loop-guard.mjs bot-guard <actor> [<allowed>]\n       node scripts/pipeline-loop-guard.mjs claim-guard < facts.json')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
