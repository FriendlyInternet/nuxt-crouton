// #4038 T4 — runGateMerge over a fake github replaying #3942. node --test scripts/lib/pr-merge-gate-io.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runGateMerge, readGateChecks } from './pr-merge-gate-io.mjs'

const SHA = '3e03110ff5510f3894a8f5a40106c56eba39c06a'
const run = (name, conclusion, o = {}) => ({ name, status: 'completed', conclusion, completed_at: '2026-11-16T17:40:00Z', started_at: '2026-11-16T17:30:00Z', check_suite: { id: 1 }, ...o })

function fake({ checkRuns = [], statuses = [], pr = {} } = {}) {
  const calls = { merge: [], removeLabel: [], createComment: [], listForRef: 0 }
  const thePr = {
    number: 3942, state: 'open', merged: false, draft: false, node_id: 'PR_x', body: 'Closes #3195\n\nstuff',
    base: { ref: 'epic/3193-plan-tests-become-a-checklist-of-command' }, head: { sha: SHA }, ...pr,
  }
  const rest = {
    issues: {
      listEventsForTimeline: 'timeline',
      removeLabel: async (a) => { calls.removeLabel.push(a) },
      createComment: async (a) => { calls.createComment.push(a) },
    },
    pulls: {
      get: async () => ({ data: thePr }),
      merge: async (a) => { calls.merge.push(a) },
    },
    checks: { listForRef: 'checks' },
    actions: { listWorkflowRunsForRepo: 'wfruns' },
    repos: { getCombinedStatusForRef: async () => ({ data: { statuses } }) },
  }
  const github = {
    rest,
    paginate: async (fn) => {
      if (fn === 'timeline') return [{ event: 'cross-referenced', source: { issue: { number: 3942, pull_request: {} } } }]
      if (fn === 'checks') { calls.listForRef++; return checkRuns }
      if (fn === 'wfruns') return []
      throw new Error(`unexpected paginate ${fn}`)
    },
    graphql: async () => ({ repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } }),
  }
  const core = { info() {}, warning() {} }
  const context = { repo: { owner: 'FriendlyInternet', repo: 'nuxt-crouton' }, payload: { issue: { number: 3195 } } }
  return { github, core, context, calls }
}

test('#4038 T4: #3942 replay (CI Gate + Actionlint failed) → no merge, no label removal, one note naming CI Gate', async () => {
  const f = fake({ checkRuns: [run('CI Gate', 'failure'), run('Actionlint workflows', 'failure'), run('Lint', 'success')] })
  const r = await runGateMerge(f)
  assert.equal(r.merged, false)
  assert.equal(f.calls.merge.length, 0)
  assert.equal(f.calls.removeLabel.length, 0)
  assert.equal(f.calls.createComment.length, 1)
  assert.match(f.calls.createComment[0].body, /CI Gate/)
  assert.match(f.calls.createComment[0].body, /reply `ok` again/)
  assert.match(r.skipped.join('\n'), /Actionlint workflows is failure/)
})

test('#4038 T4: CI Gate success and no reds → merged once with a merge commit, label removed', async () => {
  const f = fake({ checkRuns: [run('CI Gate', 'success'), run('Lint', 'success')] })
  const r = await runGateMerge(f)
  assert.equal(r.merged, true)
  assert.equal(f.calls.merge.length, 1)
  assert.equal(f.calls.merge[0].merge_method, 'merge')
  assert.equal(f.calls.merge[0].pull_number, 3942)
  assert.equal(f.calls.removeLabel.length, 1)
  assert.equal(f.calls.createComment.length, 0)
})

test('#4038 T4: a PR not into epic/* reads no checks and posts no checks note', async () => {
  const f = fake({ checkRuns: [run('CI Gate', 'success')], pr: { base: { ref: 'main' } } })
  const r = await runGateMerge(f)
  assert.equal(r.merged, false)
  assert.equal(f.calls.listForRef, 0)
  assert.equal(f.calls.createComment.length, 0)
  assert.match(r.skipped[0], /is not an `epic\/\*` branch/)
})

test('#4038 T4: readGateChecks maps a failure commit status into red', async () => {
  const f = fake({ checkRuns: [run('CI Gate', 'success')], statuses: [{ context: 'ext/scan', state: 'failure' }, { context: 'ok', state: 'success' }] })
  const r = await readGateChecks({ github: f.github, core: f.core, owner: 'o', repo: 'r', sha: SHA })
  assert.equal(r.ciGate, 'success')
  assert.deepEqual(r.red, [{ name: 'ext/scan', conclusion: 'failure' }])
})

test('#4038 T4: a failed check-run read is missing, never a merge', async () => {
  const f = fake()
  f.github.paginate = async () => { throw new Error('boom') }
  const r = await readGateChecks({ github: f.github, core: f.core, owner: 'o', repo: 'r', sha: SHA })
  assert.deepEqual(r, { ciGate: 'missing', red: [] })
})
