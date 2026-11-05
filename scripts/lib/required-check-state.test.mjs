import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDone, requiredCheckState } from './required-check-state.mjs'

const R = (o) => ({ name: 'CI Gate', started_at: '2026-11-05T16:00:00Z', ...o })

test('completed/success', () =>
  assert.equal(requiredCheckState([R({ status: 'completed', conclusion: 'success' })], 'CI Gate'), 'success'))
test('stuck in_progress with conclusion + completed_at counts as done', () =>
  assert.equal(requiredCheckState([R({ status: 'in_progress', conclusion: 'success', completed_at: '2026-11-05T16:41:46Z' })], 'CI Gate'), 'success'))
test('genuinely in progress is pending', () =>
  assert.equal(requiredCheckState([R({ status: 'in_progress', conclusion: null, completed_at: null })], 'CI Gate'), 'pending'))
test('newest attempt wins regardless of order', () => {
  const old = R({ status: 'completed', conclusion: 'failure', started_at: '2026-11-05T15:00:00Z' })
  const neu = R({ status: 'completed', conclusion: 'success', started_at: '2026-11-05T16:00:00Z' })
  assert.equal(requiredCheckState([old, neu], 'CI Gate'), 'success')
  assert.equal(requiredCheckState([neu, old], 'CI Gate'), 'success')
})
test('missing when no run has that name', () =>
  assert.equal(requiredCheckState([R({ name: 'Other', status: 'completed', conclusion: 'success' })], 'CI Gate'), 'missing'))
test('isDone catches a stuck failed run', () =>
  assert.equal(isDone({ status: 'in_progress', conclusion: 'failure', completed_at: '2026-11-05T16:41:46Z' }), true))
test('completed/failure stays pending', () =>
  assert.equal(requiredCheckState([R({ status: 'completed', conclusion: 'failure' })], 'CI Gate'), 'pending'))
