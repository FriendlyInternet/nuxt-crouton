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
  // The word form must open a line; mid-sentence mentions are discussion (#2509).
  assert.equal(isApproval('I would not lgtm this yet'), false)
  assert.equal(isApproval("I wouldn't approve this yet"), false)
  assert.equal(isApproval('Looks fine, but not approved'), false)
})

test('the word form still approves when it opens a line', () => {
  assert.equal(isApproval('LGTM, ship it'), true)
  assert.equal(isApproval('lgtm 👍'), true)
  assert.equal(isApproval('approved, go'), true)
  assert.equal(isApproval('Thanks for the screenshots.\n\nlgtm'), true)
})

// ── test-card replies (#2540) ─────────────────────────────────────────────────
import { parseTestReply, isTestOk } from './approval.mjs'

test('a line opening with ok passes a test card', () => {
  assert.equal(isTestOk('ok'), true)
  assert.equal(isTestOk('OK, works on my phone'), true)
  assert.equal(parseTestReply('ok').result, 'ok')
})

test('not ok does not pass and is parsed', () => {
  assert.equal(isTestOk('not ok'), false)
  assert.deepEqual(parseTestReply('not ok'), { result: 'not-ok', note: '' })
})

test('not ok: note extracts the note', () => {
  assert.deepEqual(parseTestReply('not ok: button is hidden on 390px'), { result: 'not-ok', note: 'button is hidden on 390px' })
  assert.deepEqual(parseTestReply('Not OK - broken'), { result: 'not-ok', note: 'broken' })
})

test('ok mid-line, quoted or in code is not a pass', () => {
  assert.equal(isTestOk("it's ok I guess"), false)
  assert.equal(isTestOk('> ok'), false)
  assert.equal(isTestOk('`ok`'), false)
  assert.equal(isTestOk('okay then'), false)
  assert.equal(parseTestReply('this is not ok').result, null)
})

test('a whole-reply ok is the owner yes-word (#2832)', () => {
  for (const b of ['ok', 'OK!', 'ok 👍', 'Ok.', 'lgtm']) assert.equal(isApproval(b), true, b)
})

test('ok followed by anything, or not on its own, is NOT a yes (#2832)', () => {
  for (const b of ['ok, but change X', "it's ok I guess", '> ok', 'not ok: X', 'okay then', '`ok`',
    '> 🤖 **tool** · posted\n\nok', '🤖 ok']) assert.equal(isApproval(b), false, b)
})

const T = '\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_'
const T1 = '  --- _Generated by [Claude Code](https://claude.ai/code)_'
test('#3060 generated-by trailer does not turn an approval into a change request', () => {
  assert.equal(isApproval('ok' + T), true)
  assert.equal(isApproval('ok' + T1), true)
  assert.equal(isApproval('lgtm' + T), true)
  assert.equal(isApproval('✅' + T), true)
  assert.equal(isApproval('ok'), true)
  assert.equal(isApproval('ok' + T + '\n\nbut do not merge yet'), false)
  assert.equal(isApproval('ok, but change X' + T), false)
})
