// layer: stack
/**
 * #2786 contract — same-package tickets serialise, different packages stay parallel.
 *
 *   node --test scripts/traffic-control.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideTraffic, releaseWaiting, scopeLabels } from './traffic-control.mjs'

test('no other work → proceed', () => {
  const v = decideTraffic({ issue: 2, labels: ['pkg:crouton-bookings'], others: [] })
  assert.equal(v.action, 'proceed')
})

test('in-progress ticket on the same package → wait for it', () => {
  const v = decideTraffic({
    issue: 2, labels: ['pkg:crouton-bookings', 'delegate'],
    others: [{ number: 1, labels: ['pkg:crouton-bookings', 'status:in-progress', 'delegate'] }],
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
      { number: 5, labels: [{ name: 'app:velo' }, { name: 'status:in-progress' }, { name: 'delegate' }] },
      { number: 3, labels: [{ name: 'app:velo' }], openPr: true },
    ],
  })
  assert.deepEqual(v.waitingFor, [3, 5])
  assert.deepEqual(scopeLabels([{ name: 'poc:x' }, 'type:feat']), ['poc:x'])
})

test('epics and hand-held in-progress tickets do not block; pipeline-owned ones do', () => {
  const mine = ['pkg:b']
  const w = (others) => decideTraffic({ issue: 9, labels: mine, others }).action
  assert.equal(w([{ number: 1, labels: ['pkg:b', 'epic', 'status:in-progress', 'delegate'], openPr: true }]), 'proceed')
  assert.equal(w([{ number: 2, labels: ['pkg:b', 'status:in-progress'] }]), 'proceed')
  assert.equal(w([{ number: 3, labels: ['pkg:b', 'status:in-progress', 'work-this'] }]), 'wait')
  assert.equal(w([{ number: 4, labels: ['pkg:b'], openPr: true }]), 'wait')
})

test('releaseWaiting releases only the lowest number per scope', async () => {
  const mk = (number, l) => ({ number, labels: l.map((name) => ({ name })) })
  const waiting = [mk(8, ['status:blocked', 'pkg:b']), mk(5, ['status:blocked', 'pkg:b']), mk(7, ['status:blocked', 'pkg:c'])]
  const added = []
  const github = { paginate: async (fn, o) => (fn === 'list' ? (o.labels === 'status:blocked' ? waiting : []) : [{ body: '<!-- traffic-wait -->' }]),
    rest: { issues: { listForRepo: 'list', listComments: 'comments',
      removeLabel: async () => {}, addLabels: async (o) => added.push(o.issue_number) },
      pulls: { list: async () => ({ data: [] }) } } }
  const released = await releaseWaiting({ github, context: { repo: { owner: 'o', repo: 'r' } } })
  assert.deepEqual(released, [5, 7])
})
