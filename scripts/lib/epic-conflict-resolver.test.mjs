import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeableState, startConflictResolver, resolverReply } from './epic-conflict-resolver.mjs'

const pr = { head: { sha: 'abc', ref: 'epic/12-x' } }
function fake({ comments = [], fail = false } = {}) {
  const calls = { comments: [], dispatch: [] }
  return { calls, github: {
    paginate: async () => comments,
    rest: {
      issues: { listComments: {}, createComment: async a => { calls.comments.push(a.body); return { data: { id: 99 } } } },
      actions: { createWorkflowDispatch: async a => { if (fail) throw new Error('boom'); calls.dispatch.push(a.inputs) } },
    } } }
}
const guard = async (_d, fn) => fn()
const go = (f, state = 'dirty', now = Date.now()) => startConflictResolver({ github: f.github, owner: 'o', repo: 'r', pull_number: 5, pr, state, handoffGuard: guard, now })

test('dirty + no marker → marker comment + dispatch', async () => {
  const f = fake(); const r = await go(f)
  assert.equal(r.status, 'started')
  assert.match(f.calls.comments[0], /epic-conflict-resolve:abc/)
  assert.deepEqual(f.calls.dispatch, [{ issue: '12', feedback: '99', branch: 'epic/12-x' }])
})
test('dirty + marker for this head → no second dispatch', async () => {
  const f = fake({ comments: [{ body: '<!-- epic-conflict-resolve:abc -->', created_at: '2020-01-01T00:00:00Z' }] })
  assert.equal((await go(f)).status, 'already'); assert.equal(f.calls.dispatch.length, 0)
})
test('dirty + resolver note under 30 min old → no dispatch', async () => {
  const now = Date.parse('2026-01-01T01:00:00Z')
  const f = fake({ comments: [{ body: '<!-- epic-conflict-resolve:old -->', created_at: '2026-01-01T00:40:00Z' }] })
  assert.equal((await go(f, 'dirty', now)).status, 'recent'); assert.equal(f.calls.dispatch.length, 0)
})
test('clean / blocked → today’s behaviour (nothing started)', async () => {
  for (const s of ['clean', 'blocked']) { const f = fake(); assert.equal((await go(f, s)).status, 'not-dirty'); assert.equal(f.calls.dispatch.length, 0) }
})
test('dispatch error → error status, reply never says "merges when the checks finish"', async () => {
  const r = await go(fake({ fail: true }))
  assert.equal(r.status, 'error')
  assert.doesNotMatch(resolverReply(r, 'epic/12-x'), /when the checks finish/)
})
test('unknown then dirty → retried, then dispatch', async () => {
  const seq = ['unknown', 'unknown', 'dirty']; let i = 0
  const github = { rest: { pulls: { get: async () => ({ data: { state: 'open', mergeable_state: seq[i++] } }) } } }
  const { state } = await mergeableState({ github, owner: 'o', repo: 'r', pull_number: 5, sleep: async () => {} })
  assert.equal(state, 'dirty'); assert.equal(i, 3)
  const f = fake(); assert.equal((await go(f, state)).status, 'started')
})
test('both workflows call the shared helper (real YAML)', () => {
  for (const [file, job] of [['automerge-epic-subpr.yml', 'startConflictResolver'], ['on-comment.yml', 'replyIfConflicting']]) {
    const y = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8')
    assert.ok(y.includes('scripts/lib/epic-conflict-resolver.mjs') && y.includes(job), file)
  }
  const oc = readFileSync(new URL('../../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  assert.ok(oc.indexOf("replyIfConflicting") < oc.indexOf('Approved — merges when the checks finish'))
})
