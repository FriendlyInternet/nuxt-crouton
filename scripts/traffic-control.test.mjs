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

test('a plan-mode ticket never blocks others, but once it has a PR it does (#3214)', () => {
  const w = (o) => decideTraffic({ issue: 9, labels: ['pkg:b'], others: [o] }).action
  const base = { number: 1, labels: ['pkg:b', 'status:in-progress', 'work-this'] }
  assert.equal(w({ ...base, planning: true }), 'proceed')
  assert.equal(w({ ...base, planning: false }), 'wait')
  assert.equal(w({ ...base, planning: true, openPr: true }), 'wait')
})

// ── Unblocks: (#3280) ───────────────────────────────────────────────────────────
import { parseUnblocks } from './traffic-control.mjs'

const velo = (number, extra = {}) => ({ number, labels: ['app:velo'], openPr: true, ...extra })

test('Unblocks: #3130 lets #3217 proceed past the open PR on #3130 (replay)', () => {
  const v = decideTraffic({ issue: 3217, labels: ['app:velo'], body: 'Fix.\n\nUnblocks: #3130\n', others: [velo(3130)] })
  assert.equal(v.action, 'proceed')
  assert.deepEqual(v.unblocking, [3130])
  assert.match(v.reason, /proceeding before #3130/)
})

test('same ticket without the line still waits', () => {
  const v = decideTraffic({ issue: 3217, labels: ['app:velo'], body: 'Fix.', others: [velo(3130)] })
  assert.equal(v.action, 'wait')
  assert.deepEqual(v.waitingFor, [3130])
})

test('Unblocks: names #1 only — an unrelated same-scope ticket still blocks', () => {
  const v = decideTraffic({ issue: 9, labels: ['app:velo'], body: 'Unblocks: #1', others: [velo(1), velo(2)] })
  assert.equal(v.action, 'wait')
  assert.deepEqual(v.waitingFor, [2])
  assert.deepEqual(v.unblocking, [1])
  assert.equal(decideTraffic({ issue: 9, labels: ['app:velo'], body: 'Unblocks: #77', others: [velo(2)] }).action, 'wait')
})

test('parseUnblocks: several numbers, case-insensitive, none, mid-sentence', () => {
  assert.deepEqual(parseUnblocks('unblocks: #1, #2 #3'), [1, 2, 3])
  assert.deepEqual(parseUnblocks('nothing here'), [])
  assert.deepEqual(parseUnblocks(undefined), [])
  assert.deepEqual(parseUnblocks('This one Unblocks: #5 later'), [])
})

test('releaseWaiting releases a parked ticket whose body has Unblocks:', async () => {
  const parked = { number: 20, body: 'Unblocks: #10', labels: [{ name: 'status:blocked' }, { name: 'app:velo' }] }
  const blocker = { number: 10, labels: [{ name: 'app:velo' }] }
  const added = []
  const github = {
    paginate: async (fn, o) => (fn === 'list' ? (o.labels === 'status:blocked' ? [parked] : [blocker]) : [{ body: '<!-- traffic-wait -->' }]),
    rest: { issues: { listForRepo: 'list', listComments: 'comments',
      removeLabel: async () => {}, addLabels: async (o) => added.push(o.issue_number) },
      pulls: { list: async () => ({ data: [{ number: 99 }] }) } } }
  const released = await releaseWaiting({ github, context: { repo: { owner: 'o', repo: 'r' } } })
  assert.deepEqual(released, [20])
})
