import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isConflicting, waitForMergeableState, startConflictResolver, approveEpicPlan,
} from './epic-conflict-resolver.mjs'

const NOW = Date.parse('2026-11-03T12:00:00Z')
const pr = { number: 7, head: { sha: 'abc123', ref: 'epic/42-thing' } }

function fake(comments = [], { failDispatch = false } = {}) {
  const calls = { comments: [], dispatches: [] }
  const github = {
    paginate: async () => comments,
    rest: {
      issues: { listComments: {}, createComment: async a => { calls.comments.push(a); return { data: { id: 99 } } } },
      actions: { createWorkflowDispatch: async a => { if (failDispatch) throw new Error('403'); calls.dispatches.push(a) } },
    },
  }
  return { github, calls }
}
const run = (f) => startConflictResolver({ github: f.github, owner: 'o', repo: 'r', pr, now: () => NOW })

test('dirty + no marker → one note + one dispatch', async () => {
  const f = fake()
  const r = await run(f)
  assert.equal(r.reason, 'started')
  assert.equal(f.calls.comments.length, 1)
  assert.deepEqual(f.calls.dispatches[0].inputs, { issue: '42', feedback: '99', branch: 'epic/42-thing' })
})

test('marker for this head → no dispatch', async () => {
  const f = fake([{ body: '<!-- epic-conflict-resolve:abc123 -->', created_at: '2020-01-01T00:00:00Z' }])
  assert.equal((await run(f)).reason, 'marker-exists')
  assert.equal(f.calls.dispatches.length, 0)
})

test('resolver note under 30 min (other sha) → none', async () => {
  const f = fake([{ body: '<!-- epic-conflict-resolve:old -->', created_at: new Date(NOW - 10 * 60000).toISOString() }])
  assert.equal((await run(f)).reason, 'recent-resolver')
  assert.equal(f.calls.dispatches.length, 0)
})

test('resolver note over 30 min → dispatches', async () => {
  const f = fake([{ body: '<!-- epic-conflict-resolve:old -->', created_at: new Date(NOW - 40 * 60000).toISOString() }])
  assert.equal((await run(f)).reason, 'started')
  assert.equal(f.calls.dispatches.length, 1)
})

test('dispatch throws → dispatch-failed', async () => {
  const r = await run(fake([], { failDispatch: true }))
  assert.equal(r.reason, 'dispatch-failed')
  assert.equal(r.error, '403')
})

function pulls(states) {
  let i = 0
  return { rest: { pulls: { get: async () => ({ data: { state: 'open', mergeable_state: states[Math.min(i++, states.length - 1)] } }) } }, count: () => i }
}
const wait = (g) => waitForMergeableState({ github: g, owner: 'o', repo: 'r', pull_number: 7, tries: 4, sleep: async () => {} })

test('unknown then dirty → dirty', async () => {
  assert.equal((await wait(pulls(['unknown', 'dirty']))).mergeable_state, 'dirty')
})
test('stays unknown → stops after tries', async () => {
  const g = pulls(['unknown'])
  assert.equal((await wait(g)).mergeable_state, 'unknown')
  assert.equal(g.count(), 4)
})
test('clean / blocked returned at once', async () => {
  for (const s of ['clean', 'blocked']) {
    const g = pulls([s])
    assert.equal((await wait(g)).mergeable_state, s)
    assert.equal(g.count(), 1)
  }
})

test('isConflicting only for dirty', () => {
  assert.equal(isConflicting({ mergeable_state: 'dirty' }), true)
  for (const s of ['clean', 'blocked', 'unknown', undefined]) assert.equal(isConflicting({ mergeable_state: s }), false)
})

test('approveEpicPlan: owner ok on a conflicting PR never merges or waits', () => {
  const dirty = { mergeable_state: 'dirty' }
  const clean = { mergeable_state: 'clean' }
  assert.equal(approveEpicPlan({ decision: { action: 'merge' }, pr: dirty }), 'resolve-conflict')
  assert.equal(approveEpicPlan({ decision: { action: 'wait' }, pr: dirty }), 'resolve-conflict')
  assert.equal(approveEpicPlan({ decision: { action: 'merge' }, pr: clean }), 'merge')
  assert.equal(approveEpicPlan({ decision: { action: 'wait' }, pr: clean }), 'wait')
  assert.equal(approveEpicPlan({ decision: { action: 'red' }, pr: dirty }), 'red')
  assert.equal(approveEpicPlan({ decision: { action: 'ignore' }, pr: dirty }), 'ignore')
})
