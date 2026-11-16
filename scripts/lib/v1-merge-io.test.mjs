import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runV1, v1OffSwitch } from './v1-merge-io.mjs'

const mk = (over = {}) => {
  const calls = { graphql: [], create: [], update: [], merge: [], comments: [], labels: [], info: [] }
  const github = {
    graphql: (async (q) => { calls.graphql.push(q); if (over.graphqlError) throw over.graphqlError }),
    paginate: (async () => over.files || [{ filename: 'apps/x/a.vue' }]),
    rest: {
      pulls: { listFiles: {}, merge: (async (a) => { calls.merge.push(a) }) },
      checks: { create: (async (a) => { calls.create.push(a) }), update: (async (a) => { calls.update.push(a) }) },
      issues: { createComment: (async (a) => { calls.comments.push(a) }), addLabels: (async (a) => { calls.labels.push(a) }) },
    },
  }
  const core = { info: (msg) => { calls.info.push(msg) }, warning: () => {} }
  return { github, core, calls }
}
const pr = (o = {}) => ({ node_id: 'N', draft: false, user: { login: 'nuxt-harness[bot]' }, base: { ref: 'epic/1--v1-x' }, head: { ref: 'work-5', sha: 'abc' }, labels: [], auto_merge: null, html_url: 'u', body: '', ...o })
const base = (m, p, extra = {}) => ({ github: m.github, core: m.core, owner: 'o', repo: 'r', env: { APP_SLUG: 'app' }, pr: p, pull_number: 5,
  go: { go: false }, prComments: [], rawRuns: [], red: false, checkState: 'success', BOTS: ['nuxt-harness[bot]'], reviewState: () => ({ kind: 'pending' }), ...extra })

test('approved: writes the check and enables auto-merge', async () => {
    const m = mk()
    const a = await runV1(base(m, pr({ labels: [{ name: 'build:approved' }] }), { reviewState: () => ({ kind: 'other' }) }))
    assert.equal(a.code, 'merge')
    assert.equal(m.calls.create[0].conclusion, 'success')
    assert.match(m.calls.graphql[0], /enablePullRequestAutoMerge/)
  })
test('no-review: check in_progress, no auto-merge call needed to merge', async () => {
    const m = mk()
    const a = await runV1(base(m, pr()))
    assert.equal(a.code, 'no-review')
    assert.equal(m.calls.create[0].status, 'in_progress')
    assert.equal(m.calls.merge.length, 0)
  })
test('clean status refusal + canMergeNow: merges once', async () => {
    const m = mk({ graphqlError: new Error('Pull request is in clean status') })
    const a = await runV1(base(m, pr({ labels: [{ name: 'build:approved' }] }), { reviewState: () => ({ kind: 'other' }) }))
    assert.equal(a.merge, true)
    assert.equal(m.calls.merge.length, 1)
  })
test('shared-code: announces the hold', async () => {
    const m = mk({ files: [{ filename: '.github/workflows/x.yml' }] })
    const a = await runV1(base(m, pr({ labels: [{ name: 'build:approved' }] }), { reviewState: () => ({ kind: 'other' }) }))
    assert.equal(a.code, 'shared-code')
    assert.deepEqual(m.calls.labels[0].labels, ['status:needs-merge'])
    assert.match(m.calls.comments[0].body, /Held for a human/)
})

// #3845: the real REST `auto_merge` shape (enabled_by + merge_method, no timestamp)
const ARMED = { enabled_by: { login: 'nuxt-harness[bot]' }, merge_method: 'merge' }

test('armed + merge answer: no graphql/merge call, logs auto-merge already armed', async () => {
  const m = mk()
  const a = await runV1(base(m, pr({ auto_merge: ARMED, labels: [{ name: 'build:approved' }] }), { reviewState: () => ({ kind: 'other' }) }))
  assert.equal(a.code, 'merge')
  assert.equal(m.calls.graphql.length, 0)
  assert.equal(m.calls.merge.length, 0)
  assert.ok(m.calls.info.some(s => /already armed \(by nuxt-harness\[bot\]\).*GitHub merges/.test(s)), m.calls.info.join('\n'))
})

test('armed + owner ok after final hold → merge answer, nothing extra', async () => {
  const m = mk()
  const a = await runV1(base(m, pr({ auto_merge: ARMED }), { go: { go: true, approvedAt: '2026-01-02' }, reviewState: () => ({ kind: 'final', at: '2026-01-01' }) }))
  assert.equal(a.code, 'merge')
  assert.equal(a.reason, 'owner ok after final hold')
  assert.equal(m.calls.create[0].conclusion, 'success')
  assert.equal(m.calls.graphql.length, 0)
  assert.equal(m.calls.merge.length, 0)
  assert.ok(m.calls.info.some(s => /already armed/.test(s)))
})

test('armed + hold (no-review): logs waiting, no graphql', async () => {
  const m = mk()
  const a = await runV1(base(m, pr({ auto_merge: ARMED })))
  assert.equal(a.code, 'no-review')
  assert.equal(m.calls.graphql.length, 0)
  assert.ok(m.calls.info.some(s => /auto-merge armed; waits on Merge decision \(no-review\)/.test(s)), m.calls.info.join('\n'))
})

test('armed with no enabled_by: logs by ?', async () => {
  const m = mk()
  await runV1(base(m, pr({ auto_merge: { merge_method: 'merge' }, labels: [{ name: 'build:approved' }] }), { reviewState: () => ({ kind: 'other' }) }))
  assert.ok(m.calls.info.some(s => /already armed \(by \?\)/.test(s)), m.calls.info.join('\n'))
})

test('disables auto-merge', async () => {
    const m = mk()
    await v1OffSwitch({ github: m.github, core: m.core, pr: pr({ auto_merge: { x: 1 } }), pull_number: 5 })
    assert.match(m.calls.graphql[0], /disablePullRequestAutoMerge/)
})

test('owner ok before a final hold → owner-held + ok-again note once', async () => {
  const m = mk()
  const a = await runV1(base(m, pr(), { go: { go: true, approvedAt: '2026-11-07T11:00:00Z' }, reviewState: () => ({ kind: 'final', at: '2026-11-07T12:00:53Z' }) }))
  assert.equal(a.code, 'owner-held')
  assert.equal(m.calls.create[0].output.title, 'held: waiting for your ok')
  assert.equal(m.calls.comments.length, 1)
  assert.match(m.calls.comments[0].body ?? String(m.calls.comments[0]), /build-ok-waiting:ok-again:abc/)
})
