import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runV1, v1OffSwitch } from './v1-merge-io.mjs'

const mk = (over = {}) => {
  const calls = { graphql: [], create: [], update: [], merge: [], comments: [], labels: [] }
  const github = {
    graphql: (async (q) => { calls.graphql.push(q); if (over.graphqlError) throw over.graphqlError }),
    paginate: (async () => over.files || [{ filename: 'apps/x/a.vue' }]),
    rest: {
      pulls: { listFiles: {}, merge: (async (a) => { calls.merge.push(a) }) },
      checks: { create: (async (a) => { calls.create.push(a) }), update: (async (a) => { calls.update.push(a) }) },
      issues: { createComment: (async (a) => { calls.comments.push(a) }), addLabels: (async (a) => { calls.labels.push(a) }) },
    },
  }
  const core = { info: () => {}, warning: () => {} }
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

test('disables auto-merge', async () => {
    const m = mk()
    await v1OffSwitch({ github: m.github, core: m.core, pr: pr({ auto_merge: { x: 1 } }), pull_number: 5 })
    assert.match(m.calls.graphql[0], /disablePullRequestAutoMerge/)
})
