/**
 * #2786 contract — same-package tickets serialise, different packages stay parallel.
 *
 *   node --test scripts/traffic-control.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTraffic, scopeLabels } from './traffic-control.mjs'

test('no other work → proceed', () => {
  const v = decideTraffic({ issue: 2, labels: ['pkg:crouton-bookings'], others: [] })
  assert.equal(v.action, 'proceed')
})

test('in-progress ticket on the same package → wait for it', () => {
  const v = decideTraffic({
    issue: 2, labels: ['pkg:crouton-bookings', 'delegate'],
    others: [{ number: 1, labels: ['pkg:crouton-bookings', 'status:in-progress'] }],
  })
  assert.equal(v.action, 'wait')
  assert.deepEqual(v.waitingFor, [1])
  assert.match(v.reason, /#1/)
})

test('open work PR on the same package → wait, even without in-progress', () => {
  const v = decideTraffic({
    issue: 2, labels: ['pkg:crouton-bookings'],
    others: [{ number: 1, labels: ['pkg:crouton-bookings'], openPr: true }],
  })
  assert.equal(v.action, 'wait')
})

test('different package runs in parallel', () => {
  const v = decideTraffic({
    issue: 2, labels: ['pkg:crouton-bookings'],
    others: [{ number: 1, labels: ['pkg:crouton-events', 'status:in-progress'], openPr: true }],
  })
  assert.equal(v.action, 'proceed')
})

test('same package but idle (no in-progress, no PR) does not block', () => {
  const v = decideTraffic({
    issue: 2, labels: ['pkg:crouton-bookings'],
    others: [{ number: 1, labels: ['pkg:crouton-bookings'] }],
  })
  assert.equal(v.action, 'proceed')
})

test('ticket never waits for itself; no scope label → proceed', () => {
  assert.equal(decideTraffic({
    issue: 2, labels: ['pkg:a'], others: [{ number: 2, labels: ['pkg:a', 'status:in-progress'] }],
  }).action, 'proceed')
  assert.equal(decideTraffic({
    issue: 2, labels: ['delegate'], others: [{ number: 1, labels: ['pkg:a', 'status:in-progress'] }],
  }).action, 'proceed')
})

test('accepts label objects and lists every blocker sorted', () => {
  const v = decideTraffic({
    issue: 9, labels: [{ name: 'app:velo' }],
    others: [
      { number: 5, labels: [{ name: 'app:velo' }, { name: 'status:in-progress' }] },
      { number: 3, labels: [{ name: 'app:velo' }], openPr: true },
    ],
  })
  assert.deepEqual(v.waitingFor, [3, 5])
  assert.deepEqual(scopeLabels([{ name: 'poc:x' }, 'type:feat']), ['poc:x'])
})
