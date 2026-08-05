#!/usr/bin/env node
// pipeline-loop-guard.mjs — WS4 of epic #1685: the loop-guards that make the event-driven,
// label-handoff pipeline (WS3) safe to turn on. Pure + unit-tested (pipeline-loop-guard.test.mjs)
// so the invariants that broke at #457 can't silently regress when the decomposer starts
// emitting labels.
//
// THE THREE INVARIANTS (each has a function here; the workflows / the decomposer wire to them):
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
// These MUST stay in lockstep with the caps in `.claude/agents/task-decomposer.md` and the job
// `if:` blocks in the two `*-pidev.yml` workflows. This file is the single tested source.

import { pathToFileURL } from 'node:url'

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

// ── CLI ──────────────────────────────────────────────────────────────────────────
//   node scripts/pipeline-loop-guard.mjs bot-guard <actor> [<allowed>]
//     → exit 0 if allowed, exit 1 (with an ::error::) if a disallowed bot. Used as the
//       workflow's Bot-actor guard step so the SHIPPED guard is the unit-tested function.
function main(argv) {
  const [cmd, ...rest] = argv
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
  console.error('usage: node scripts/pipeline-loop-guard.mjs bot-guard <actor> [<allowed>]')
  process.exit(2)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2))
}
