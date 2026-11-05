#!/usr/bin/env node
/**
 * requeue-bumped-preview.mjs — self-heal a preview deploy that a queue bump
 * cancelled (#2188, follow-up to #1150).
 *
 * WHY. Per-PR previews (#2020) deploy through the shared per-app staging
 * concurrency group. A newer deploy (merge to `main`, or a sibling PR touching
 * the same app) cancels the in-flight one. When the cancel lands AFTER the Worker
 * is live but BEFORE the "Seed review login" / "Seed collection + demo data"
 * steps in deploy-app.yml, the preview serves an UNSEEDED DB → the advertised
 * review login is rejected ("Invalid email or password"). #1150 made this
 * legible (the "bumped, not broken" comment) but never RECOVERED it: the owner
 * had to re-run by hand. This makes it fix itself.
 *
 * MECHANISM. A thin `workflow_run`-completed workflow (the human-applied patch —
 * this script's token can't write .github/workflows/**, #1076) calls this on
 * every "Deploy Apps" completion. This script decides whether to auto re-run the
 * cancelled run, and if so does it via `gh run rerun --failed`.
 *
 *   - Only a `pull_request`-triggered preview that ended `cancelled` is eligible
 *     (a push→main staging deploy or a manual production dispatch is NEVER
 *     re-run — a cancel there is real, not queue mechanics).
 *   - BOUNDED (acceptance criterion 3): re-run only while run_attempt <
 *     MAX_ATTEMPTS, so at most ONE automatic retry. Re-running increments the
 *     run's attempt, so a second bump reaches the cap and we STOP — the existing
 *     #1150 "bumped, not broken" notice then stands as the actionable fallback.
 *     This is what keeps it from looping forever on a busy queue.
 *   - IDEMPOTENT downstream (criterion 2): the re-run replays the SAME deploy,
 *     whose seed steps upsert by stable id (seed-review-login.mjs #832/#1185,
 *     crouton-seed) — so a re-run never errors on "already exists".
 *
 * The decision is a PURE function (`decideRequeue`) so it is unit-tested
 * (requeue-bumped-preview.test.mjs) without touching GitHub — mirrors the
 * deploy-detect.mjs / packages-guard.mjs pattern. Only the CLI shells out.
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** The workflow whose cancelled preview runs we self-heal. Must match `name:` in deploy-apps.yml. */
export const TARGET_WORKFLOW = 'Deploy Apps'

/**
 * How many total attempts a preview run may reach before we stop auto-requeuing.
 * run_attempt starts at 1, and re-running increments it — so MAX_ATTEMPTS = 2
 * permits exactly ONE automatic retry (requeue only while attempt < 2), then the
 * #1150 human notice becomes the fallback. Bounded by design (criterion 3).
 */
export const MAX_ATTEMPTS = 2

/**
 * Pure decision: given the completed workflow_run's facts, should we re-run it?
 * Returns { requeue: boolean, reason: string } — reason is logged either way so
 * a skipped requeue is never silent (the AGENTS.md "can this exit 0 doing
 * nothing?" rule: we always say what we decided and why).
 *
 * @param {object} run
 * @param {string} run.workflowName  github.event.workflow_run.name
 * @param {string} run.conclusion    github.event.workflow_run.conclusion
 * @param {string} run.event         github.event.workflow_run.event (the trigger of the cancelled run)
 * @param {number} run.runAttempt    github.event.workflow_run.run_attempt
 * @param {number} [maxAttempts=MAX_ATTEMPTS]
 */
export function decideRequeue(run, maxAttempts = MAX_ATTEMPTS) {
  const { workflowName, conclusion, event } = run || {}
  const runAttempt = Number(run?.runAttempt)

  if (workflowName !== TARGET_WORKFLOW) {
    return { requeue: false, reason: `not the target workflow (${workflowName || 'unknown'} ≠ ${TARGET_WORKFLOW})` }
  }
  if (conclusion !== 'cancelled') {
    // A genuine success/failure is not a queue bump — leave it alone.
    return { requeue: false, reason: `conclusion is "${conclusion}", not "cancelled" — not a queue bump` }
  }
  if (event !== 'pull_request') {
    // Only PR previews get bumped by the caller's cancel-in-progress (deploy-apps.yml,
    // pull_request only). A cancelled push/dispatch is real; never auto-re-run it.
    return { requeue: false, reason: `triggering event was "${event}", not "pull_request" — not a preview bump` }
  }
  if (!Number.isFinite(runAttempt) || runAttempt < 1) {
    return { requeue: false, reason: `run_attempt "${run?.runAttempt}" is not a valid attempt number — refusing to re-run` }
  }
  if (runAttempt >= maxAttempts) {
    // Cap reached: stop so a busy queue can't loop us forever. The #1150
    // "bumped, not broken" comment is the actionable fallback.
    return { requeue: false, reason: `retry cap reached (attempt ${runAttempt} ≥ ${maxAttempts}) — leaving the #1150 notice as the fallback` }
  }
  return { requeue: true, reason: `preview deploy bumped (cancelled) on attempt ${runAttempt} — auto re-running once (cap ${maxAttempts})` }
}

/** Read the workflow_run facts the calling workflow exposes via env. */
export function runFromEnv(env = process.env) {
  return {
    workflowName: env.WORKFLOW_NAME,
    conclusion: env.CONCLUSION,
    event: env.EVENT,
    runAttempt: Number(env.RUN_ATTEMPT)
  }
}

function info(msg) {
  console.log(`[requeue-bumped-preview] ${msg}`)
}

async function main(env = process.env) {
  const runId = env.RUN_ID
  if (!runId) {
    console.error('[requeue-bumped-preview] no RUN_ID in env — cannot identify the cancelled run; nothing to do.')
    process.exit(0)
  }
  const decision = decideRequeue(runFromEnv(env))
  info(decision.reason)
  if (!decision.requeue) {
    process.exit(0)
  }
  // Re-run only the failed/cancelled jobs of the bumped run. `gh` uses GH_TOKEN
  // from the env (the calling workflow supplies it). Re-running increments the
  // run's attempt, so the cap in decideRequeue() is what bounds the loop.
  try {
    execFileSync('gh', ['run', 'rerun', String(runId), '--failed'], { stdio: 'inherit', env })
    info(`requested re-run of the bumped preview deploy (run ${runId}).`)
  } catch (e) {
    // Best-effort: a rerun hiccup must not fail this listener (the #1150 notice
    // still stands). Report it loudly instead of exiting non-zero.
    console.error(`[requeue-bumped-preview] ⚠ could not re-run ${runId}: ${e?.message || e} — the #1150 "bumped, not broken" notice remains the fallback.`)
  }
  process.exit(0)
}

// Only run as a CLI — the module is imported by the unit test for decideRequeue,
// and importing must not shell out to `gh`.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
