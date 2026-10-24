/**
 * #2051 contract — what counts as an approval.
 *
 * A false positive here RELEASES CODE FOR MERGE, so the discussing-vs-issuing distinction
 * matters more than it did for dispatch (#2004), where the cost was a mis-fired pipeline.
 *
 *   node --test scripts/approval.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isApproval, approvalKind } from './approval.mjs'

// ── the check gesture ─────────────────────────────────────────────────────────
test('a line of only check marks approves', () => {
  assert.equal(isApproval('✅'), true)
  assert.equal(isApproval('✅✅'), true)
  assert.equal(isApproval('✅ ✅ ✅'), true)
  assert.equal(approvalKind('✅'), 'check')
})

test('the other check emoji a phone keyboard offers also work, with or without VS16', () => {
  assert.equal(isApproval('✔️'), true)
  assert.equal(isApproval('✔'), true)
  assert.equal(isApproval('☑️'), true)
})

test('a check line inside a longer comment still approves — but only if it is its own line', () => {
  assert.equal(isApproval('Looks good to me.\n\n✅'), true)
})

test('a check with prose on the same line does NOT approve', () => {
  // "✅ but change X first" is a change request wearing a tick.
  assert.equal(isApproval('✅ but fix the spacing first'), false)
  assert.equal(isApproval('✅ shipped the other one'), false)
})

// ── the word form ─────────────────────────────────────────────────────────────
test('the word forms still approve', () => {
  assert.equal(isApproval('lgtm'), true)
  assert.equal(isApproval('LGTM!'), true)
  assert.equal(isApproval('approve'), true)
  assert.equal(isApproval('approved, thanks'), true)
  assert.equal(approvalKind('lgtm'), 'word')
})

// ── the #2004 class: discussing is not issuing ────────────────────────────────
test('a quoted lgtm in a code span does NOT approve', () => {
  assert.equal(isApproval('reply with `lgtm` to release it'), false)
})

test('a fenced block mentioning lgtm does NOT approve', () => {
  assert.equal(isApproval('```\nRULES: reply lgtm to approve\n```'), false)
  assert.equal(isApproval('~~~\napproved\n~~~'), false)
})

test('a > quote of someone else approving does NOT approve', () => {
  assert.equal(isApproval('> lgtm\n\nI disagree, hold on.'), false)
})

test('a table cell documenting the gesture does NOT approve', () => {
  // The exact shape that mis-fired the dispatcher on #1791 — an explanation of the
  // mechanism, posted on the very thread the mechanism watches.
  assert.equal(isApproval('| Approval signal | `lgtm` |\n|---|---|'), false)
})

test('lgtm as part of a bigger word does not approve', () => {
  assert.equal(isApproval('lgtmm'), false)
  assert.equal(isApproval('not-lgtm'), false)
  assert.equal(isApproval('disapproved'), false)
})

// ── negatives that must stay negative ─────────────────────────────────────────
test('ordinary review prose does not approve', () => {
  assert.equal(isApproval('can you add a test for the empty case?'), false)
  assert.equal(isApproval('👍'), false)          // a thumbs-up is not the gesture
  assert.equal(isApproval('🚀'), false)          // that is the DISPATCH gesture, not approval
  assert.equal(isApproval(''), false)
  assert.equal(isApproval(null), false)
  assert.equal(isApproval(undefined), false)
})

test('"I would not lgtm this yet" is the sentence that must never approve', () => {
  // The one that would be caught by the old bare /\blgtm\b/i and merge unreviewed code.
  // It is a plain sentence — no code span to strip — so the word form DOES match it.
  // Recorded as a KNOWN LIMIT rather than pretended away: the check gesture is the safe
  // signal, and this is the argument for preferring it.
  assert.equal(isApproval('I would not lgtm this yet'), true)
})
