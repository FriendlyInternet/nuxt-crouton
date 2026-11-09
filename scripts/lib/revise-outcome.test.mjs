import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyKey, reviseOutcome } from './revise-outcome.mjs'

test('head moved, body unchanged', () => {
  assert.deepEqual(reviseOutcome({ headMoved: true }), { revised: true, noop: false, rereview: false, note: 'commit' })
})
test('head moved and body changed: commit wins, no double review', () => {
  const r = reviseOutcome({ headMoved: true, bodyChanged: true, verdict: 'no-go', round: 1 })
  assert.equal(r.note, 'commit'); assert.equal(r.rereview, false)
})
test('body only, no-go round 1 -> re-review', () => {
  const r = reviseOutcome({ bodyChanged: true, verdict: 'no-go', round: 1 })
  assert.deepEqual(r, { revised: true, noop: false, rereview: true, note: 'body' })
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
  const r = reviseOutcome({ basePushed: true })
  assert.equal(r.revised, true); assert.equal(r.note, 'commit')
})
test('bodyKey normalises and handles empty', () => {
  assert.equal(bodyKey('a\r\nb\n'), bodyKey('a\nb'))
  assert.notEqual(bodyKey('a'), bodyKey('b'))
  assert.equal(bodyKey(''), ''); assert.equal(bodyKey(null), '')
})
