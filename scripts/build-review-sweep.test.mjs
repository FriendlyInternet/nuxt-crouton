import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsReview } from './build-review-sweep.mjs'

const now = Date.parse('2026-11-02T12:00:00Z')
const pr = (o = {}) => ({ headRefName: 'work-1', baseRefName: 'main', headRefOid: 'X', state: 'OPEN', isDraft: false, author: { login: 'app/nuxt-harness' }, ...o })
const gate = (o = {}) => [{ name: 'CI Gate', status: 'completed', conclusion: 'success', started_at: '2026-11-02T11:00:00Z', completed_at: '2026-11-02T11:30:00Z', ...o }]
const run = (o = {}) => needsReview({ pr: pr(), checks: gate(), comments: [], headCommitDate: '2026-11-02T10:00:00Z', now, ...o })

test('(a) green, old, no markers → needs review (main and epic)', () => {
  assert.equal(run(), true)
  assert.equal(run({ pr: pr({ baseRefName: 'epic/1-x' }) }), true)
})
test('(b) review marker present → no', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-sha:X -->', created_at: '2026-11-02T11:40:00Z' }] }), false)
})
test('(c) younger than 15 min → no', () => {
  assert.equal(run({ checks: gate({ completed_at: '2026-11-02T11:50:00Z' }) }), false)
})
test('(d) CI Gate not success → no', () => {
  assert.equal(run({ checks: gate({ conclusion: 'failure' }) }), false)
  assert.equal(run({ checks: [] }), false)
})
test('(e) sweep already dispatched for this SHA → no', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-sweep:X -->', created_at: '2026-11-02T11:45:00Z' }] }), false)
})
test('(f) failed review on this SHA is not re-dispatched', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-failed -->', created_at: '2026-11-02T11:00:00Z' }] }), false)
  assert.equal(run({ comments: [{ body: '<!-- build-review-failed -->\n<!-- build-review-failed-sha:X -->', created_at: '2026-11-02T09:00:00Z' }] }), false)
})
test('(g) push after a failure re-arms', () => {
  assert.equal(run({ pr: pr({ headRefOid: 'Y' }), comments: [{ body: '<!-- build-review-failed -->\n<!-- build-review-failed-sha:X -->', created_at: '2026-11-02T09:00:00Z' }] }), true)
  assert.equal(run({ headCommitDate: '2026-11-02T11:20:00Z', comments: [{ body: '<!-- build-review-failed -->', created_at: '2026-11-02T11:00:00Z' }] }), true)
})
test('(h) draft or non-bot → no', () => {
  assert.equal(run({ pr: pr({ isDraft: true }) }), false)
  assert.equal(run({ pr: pr({ author: { login: 'pmcp' } }) }), false)
})
