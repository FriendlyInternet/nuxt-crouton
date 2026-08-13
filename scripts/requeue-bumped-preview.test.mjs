#!/usr/bin/env node
/**
 * Contract for scripts/requeue-bumped-preview.mjs (#2188).
 *
 * The self-heal decision is a PURE function so it can be proven here without
 * touching GitHub (mirrors deploy-detect.test.mjs / packages-guard.test.mjs).
 * These cases ARE the acceptance criteria of #2188, in plain language:
 *
 *   1. A PR preview cancelled by a queue bump on its first attempt → re-run once.
 *   2. Bounded: once the retry cap is reached, STOP (fall back to the #1150 notice).
 *   3. A genuine success/failure is never re-run (only "cancelled" is a bump).
 *   4. A cancelled push→main / manual dispatch is never re-run (real cancel, not a bump).
 *   5. A different workflow's run is ignored.
 *   6. A malformed run_attempt refuses to re-run (never guess).
 *   7. runFromEnv reads the workflow_run facts the listener exposes via env.
 *
 * Run: node --test scripts/requeue-bumped-preview.test.mjs
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  decideRequeue,
  runFromEnv,
  MAX_ATTEMPTS,
  TARGET_WORKFLOW
} from './requeue-bumped-preview.mjs'

/** A well-formed "cancelled PR preview on attempt 1" run — the happy path. */
function bumpedPreview(overrides = {}) {
  return {
    workflowName: TARGET_WORKFLOW,
    conclusion: 'cancelled',
    event: 'pull_request',
    runAttempt: 1,
    ...overrides
  }
}

test('criterion 1: a cancelled PR preview on its first attempt is re-run once', () => {
  const { requeue } = decideRequeue(bumpedPreview())
  assert.equal(requeue, true)
})

test('criterion 3 (bounded): at the retry cap it stops, leaving the #1150 notice', () => {
  const atCap = decideRequeue(bumpedPreview({ runAttempt: MAX_ATTEMPTS }))
  assert.equal(atCap.requeue, false)
  assert.match(atCap.reason, /cap/i)

  // And a second automatic retry (attempt beyond the cap) also stops.
  const beyond = decideRequeue(bumpedPreview({ runAttempt: MAX_ATTEMPTS + 1 }))
  assert.equal(beyond.requeue, false)
})

test('a genuine success is never re-run (not a queue bump)', () => {
  assert.equal(decideRequeue(bumpedPreview({ conclusion: 'success' })).requeue, false)
})

test('a genuine failure is never re-run (not a queue bump)', () => {
  assert.equal(decideRequeue(bumpedPreview({ conclusion: 'failure' })).requeue, false)
})

test('a cancelled push→main deploy is never auto-re-run (real cancel, not a preview bump)', () => {
  const pushCancel = decideRequeue(bumpedPreview({ event: 'push' }))
  assert.equal(pushCancel.requeue, false)
  assert.match(pushCancel.reason, /pull_request/)
})

test('a cancelled manual production dispatch is never auto-re-run', () => {
  assert.equal(decideRequeue(bumpedPreview({ event: 'workflow_dispatch' })).requeue, false)
})

test('a different workflow is ignored', () => {
  const other = decideRequeue(bumpedPreview({ workflowName: 'CI' }))
  assert.equal(other.requeue, false)
  assert.match(other.reason, /target workflow/i)
})

test('a malformed run_attempt refuses to re-run (never guess)', () => {
  assert.equal(decideRequeue(bumpedPreview({ runAttempt: NaN })).requeue, false)
  assert.equal(decideRequeue(bumpedPreview({ runAttempt: 0 })).requeue, false)
  assert.equal(decideRequeue(bumpedPreview({ runAttempt: undefined })).requeue, false)
})

test('a null/empty run is handled without throwing', () => {
  assert.equal(decideRequeue(null).requeue, false)
  assert.equal(decideRequeue({}).requeue, false)
})

test('every decision carries a non-empty reason (never a silent skip)', () => {
  for (const run of [bumpedPreview(), bumpedPreview({ conclusion: 'success' }), {}, null]) {
    const { reason } = decideRequeue(run)
    assert.ok(typeof reason === 'string' && reason.length > 0)
  }
})

test('runFromEnv reads the workflow_run facts the listener exposes', () => {
  const run = runFromEnv({
    WORKFLOW_NAME: TARGET_WORKFLOW,
    CONCLUSION: 'cancelled',
    EVENT: 'pull_request',
    RUN_ATTEMPT: '1'
  })
  assert.deepEqual(run, {
    workflowName: TARGET_WORKFLOW,
    conclusion: 'cancelled',
    event: 'pull_request',
    runAttempt: 1
  })
  // And that parsed shape drives a re-run.
  assert.equal(decideRequeue(run).requeue, true)
})
