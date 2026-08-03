/**
 * #1688 contract — the wave scheduler's green-branch gate.
 *
 * The incident it encodes: on epic #1652, #1655 merged a deliberately FAILING test contract
 * (correct — that is the test-first gate), its implementation run then died on a provider
 * quota, and the wave scheduler released wave 2 onto a branch with 35 red tests and a
 * throwing parser.
 *
 *   node --test scripts/wave-gate.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseBlockers,
  isDispatched,
  summarizeChecks,
  shouldRelease,
  formatHoldComment,
  formatReleaseComment,
  HOLD_MARKER,
} from './wave-gate.mjs'

test('parseBlockers reads one and many blockers', () => {
  assert.deepEqual(parseBlockers('Blocked-by: #454'), [454])
  assert.deepEqual(parseBlockers('Blocked-by: #275, #276'), [275, 276])
  assert.deepEqual(parseBlockers('body\n\nBlocked-by: #1655, #1656\n'), [1655, 1656])
})

test('parseBlockers dedupes and tolerates no line', () => {
  assert.deepEqual(parseBlockers('Blocked-by: #5, #5'), [5])
  assert.deepEqual(parseBlockers('no dependency line here'), [])
  assert.deepEqual(parseBlockers(''), [])
  assert.deepEqual(parseBlockers(undefined), [])
})

test('isDispatched catches both in-flight labels, in either shape', () => {
  assert.equal(isDispatched(['delegate']), true)
  assert.equal(isDispatched([{ name: 'status:in-progress' }]), true)
  assert.equal(isDispatched([{ name: 'type:feat' }]), false)
  assert.equal(isDispatched([]), false)
})

// ── summarizeChecks ──────────────────────────────────────────────────────────

test('all completed + successful → success', () => {
  assert.equal(summarizeChecks([
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'success' },
  ]), 'success')
})

test('any failure → failure (the #1652 case)', () => {
  assert.equal(summarizeChecks([
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'failure' },
  ]), 'failure')
})

test('timed_out / cancelled / action_required all count as failure', () => {
  for (const conclusion of ['timed_out', 'cancelled', 'action_required']) {
    assert.equal(summarizeChecks([{ status: 'completed', conclusion }]), 'failure', conclusion)
  }
})

test('unfinished CI is pending, never success — releasing on it reopens the race', () => {
  assert.equal(summarizeChecks([
    { status: 'completed', conclusion: 'success' },
    { status: 'in_progress', conclusion: null },
  ]), 'pending')
  assert.equal(summarizeChecks([{ status: 'queued', conclusion: null }]), 'pending')
})

test('skipped and neutral runs are ignored, not treated as green', () => {
  assert.equal(summarizeChecks([{ status: 'completed', conclusion: 'skipped' }]), 'unknown')
  assert.equal(summarizeChecks([
    { status: 'completed', conclusion: 'skipped' },
    { status: 'completed', conclusion: 'failure' },
  ]), 'failure')
})

test('no checks at all → unknown (must not hard-block a repo with no CI for that ref)', () => {
  assert.equal(summarizeChecks([]), 'unknown')
})

// ── shouldRelease ────────────────────────────────────────────────────────────

const CLOSED = ['closed', 'closed']

test('THE #1652 CASE: blockers closed but branch red → held', () => {
  const d = shouldRelease({ blockerStates: ['closed'], branchStatus: 'failure' })
  assert.equal(d.release, false)
  assert.equal(d.reason, 'branch-red')
})

test('blockers closed and branch green → released', () => {
  const d = shouldRelease({ blockerStates: CLOSED, branchStatus: 'success' })
  assert.equal(d.release, true)
  assert.equal(d.reason, 'green')
})

test('an open blocker holds regardless of branch colour', () => {
  assert.equal(shouldRelease({ blockerStates: ['closed', 'open'], branchStatus: 'success' }).reason, 'blockers-open')
})

test('an already-dispatched issue is never re-released', () => {
  const d = shouldRelease({ blockerStates: CLOSED, labels: ['delegate'], branchStatus: 'success' })
  assert.equal(d.release, false)
  assert.equal(d.reason, 'already-dispatched')
})

test('pending and unknown still RELEASE — the gate stops silent-bad, not slow', () => {
  // Deliberate: holding on pending/unknown would deadlock any chain whose ref has no CI,
  // and this workflow has no timer to rescue it.
  assert.equal(shouldRelease({ blockerStates: CLOSED, branchStatus: 'pending' }).release, true)
  assert.equal(shouldRelease({ blockerStates: CLOSED, branchStatus: 'unknown' }).release, true)
  assert.equal(shouldRelease({ blockerStates: CLOSED, branchStatus: 'unknown' }).reason, 'ungated-unknown')
})

test('no blockers → nothing to release', () => {
  assert.equal(shouldRelease({ blockerStates: [], branchStatus: 'success' }).reason, 'no-blockers')
})

test('defaults are safe when called with nothing', () => {
  assert.equal(shouldRelease().release, false)
})

// ── comments ─────────────────────────────────────────────────────────────────

test('the hold comment is deduped, self-resolving and overridable', () => {
  const c = formatHoldComment({ issueNumber: 1656, branch: 'epic/1652-sales-paste-import', doneNumber: 1655 })
  assert.ok(c.startsWith(HOLD_MARKER))
  assert.match(c, /epic\/1652-sales-paste-import` is red/)
  assert.match(c, /releases itself/)       // no human action needed in the normal case
  assert.match(c, /apply `delegate` by hand to override/) // but an escape hatch exists
})

test('the release comment names the blocker and only claims green when it is', () => {
  assert.match(formatReleaseComment({ doneNumber: 1655, branchStatus: 'success' }), /Its branch is green/)
  assert.doesNotMatch(formatReleaseComment({ doneNumber: 1655, branchStatus: 'unknown' }), /green/)
})
