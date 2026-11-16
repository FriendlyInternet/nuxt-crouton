import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyKey, reviseOutcome, requestFailed } from './revise-outcome.mjs'

test('head moved, body unchanged', () => {
  assert.deepEqual(reviseOutcome({ headMoved: true }), { revised: true, noop: false, rereview: false, note: 'commit', message: '' })
})
test('head moved and body changed: commit wins, no double review', () => {
  const r = reviseOutcome({ headMoved: true, bodyChanged: true, verdict: 'no-go', round: 1 })
  assert.equal(r.note, 'commit'); assert.equal(r.rereview, false)
})
test('body only, no-go round 1 -> re-review', () => {
  const r = reviseOutcome({ bodyChanged: true, verdict: 'no-go', round: 1 })
  assert.deepEqual(r, { revised: true, noop: false, rereview: true, note: 'body', message: '' })
})
test('body only, no-go round 2 -> no re-review', () => {
  const r = reviseOutcome({ bodyChanged: true, verdict: 'no-go', round: 2 })
  assert.equal(r.revised, true); assert.equal(r.rereview, false)
})
test('body only, go or none -> no re-review', () => {
  assert.equal(reviseOutcome({ bodyChanged: true, verdict: 'go', round: 1 }).rereview, false)
  assert.equal(reviseOutcome({ bodyChanged: true }).rereview, false)
})
test('reply only', () => {
  assert.equal(reviseOutcome({ replied: true }).note, 'reply')
})
test('nothing -> noop', () => {
  const r = reviseOutcome({})
  assert.equal(r.noop, true); assert.equal(r.revised, false)
})
test('base pushed only', () => {
  // #3775: a base merge alone is not the requested change (was: revised, note commit).
  const r = reviseOutcome({ baseOnly: true })
  assert.equal(r.revised, false); assert.equal(r.note, 'noop')
})
test('baseOnly, no reply, no body change -> noop: brought up to date, change not made (#3775)', () => {
  const r = reviseOutcome({ baseOnly: true, base: 'main', from: 'https://x/c1' })
  assert.equal(r.noop, true); assert.equal(r.revised, false); assert.equal(r.note, 'noop')
  assert.match(r.message, /Brought up to date with `main`/)
  assert.match(r.message, /\[your change\]\(https:\/\/x\/c1\) was not made/)
  assert.match(r.message, /^<!-- pipeline-note -->/)
})
test('baseOnly + a worker reply claiming a fix, no commit -> noop with "described but not pushed" (#3775 test 2, #3756 shape)', () => {
  const r = reviseOutcome({ baseOnly: true, replied: true, base: 'main', from: 'https://x/c1' })
  assert.equal(r.note, 'noop'); assert.equal(r.noop, true); assert.equal(r.revised, false)
  assert.match(r.message, /Brought up to date with `main`/)
  assert.match(r.message, /\[your change\]\(https:\/\/x\/c1\) was not made/)
  assert.match(r.message, /the worker described a change, but no commit with it was pushed/i)
  assert.match(r.message, /^<!-- pipeline-note -->/)
})
test('real commit after the merge -> revised', () => {
  assert.equal(reviseOutcome({ headMoved: true, baseOnly: true }).note, 'commit')
})
test('PR-description change only (with a base merge) -> body', () => {
  assert.equal(reviseOutcome({ baseOnly: true, bodyChanged: true }).note, 'body')
})
test('reply without baseOnly -> empty message (today: no extra comment)', () => {
  assert.equal(reviseOutcome({ replied: true }).message, '')
})
test('nothing, no base merge -> the old "produced no change" text', () => {
  assert.match(reviseOutcome({ from: 'u' }).message, /\[Your comment\]\(u\) produced no change and no answer\.\*\* Nothing was pushed/)
})
test('requestFailed: 0 / empty / missing = ok, anything else = the code (#3775)', () => {
  assert.equal(requestFailed('0'), null); assert.equal(requestFailed(''), null); assert.equal(requestFailed(undefined), null)
  assert.equal(requestFailed('1'), '1'); assert.equal(requestFailed(' 137 '), '137')
})
test('worker failed (rc!=0) even with a commit -> not revised, no "rephrase", names the exit code (#3775)', () => {
  for (const input of [{ headMoved: true }, { baseOnly: true }, { baseOnly: true, replied: true }, { bodyChanged: true }, {}]) {
    const r = reviseOutcome({ ...input, requestRc: '137', from: 'https://x/c1' })
    assert.equal(r.revised, false); assert.equal(r.noop, false); assert.equal(r.note, 'worker-failed')
    assert.equal(r.output, 'request_failed=137')
    assert.match(r.error, /exit 137/)
    assert.match(r.message, /^<!-- pipeline-note -->/)
    assert.match(r.message, /worker failed \(exit 137\)/)
    assert.doesNotMatch(r.message, /Rephrase/i)
  }
})
test('rc 0 changes nothing: the usual verdicts stand (#3775)', () => {
  assert.equal(reviseOutcome({ headMoved: true, requestRc: '0' }).note, 'commit')
  const r = reviseOutcome({ baseOnly: true, requestRc: '0' })
  assert.equal(r.note, 'noop'); assert.equal(r.output, 'revise_noop=1')
})
test('bodyKey normalises and handles empty', () => {
  assert.equal(bodyKey('a\r\nb\n'), bodyKey('a\nb'))
  assert.notEqual(bodyKey('a'), bodyKey('b'))
  assert.equal(bodyKey(''), ''); assert.equal(bodyKey(null), '')
})
