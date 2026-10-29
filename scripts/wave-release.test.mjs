import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseReady, closeLinkedIssues } from './wave-release.mjs'

const lbl = names => names.map(name => ({ name }))

// A fake github-script world: `issues` maps number → { state, labels }, `found` is the search hit list.
function world({ found = [], issues = {} } = {}) {
  const calls = { addLabels: [], comments: [], updates: [] }
  const github = {
    paginate: async fn => (fn === github.rest.search.issuesAndPullRequests ? found : []),
    rest: {
      search: { issuesAndPullRequests: () => {} },
      checks: { listForRef: () => {} },
      issues: {
        get: async ({ issue_number }) => ({ data: issues[issue_number] }),
        addLabels: async a => calls.addLabels.push(a),
        createComment: async a => calls.comments.push(a),
        update: async a => calls.updates.push(a),
        listComments: () => {},
        listEventsForTimeline: () => {},
      },
      pulls: { get: async () => ({ data: {} }) },
    },
  }
  const log = []
  const core = { info: m => log.push(m), warning: m => log.push(m) }
  const context = { repo: { owner: 'o', repo: 'r' }, payload: {} }
  return { github, core, context, calls, log }
}

test('all blockers closed → release with delegate', async () => {
  const w = world({
    found: [{ number: 10, body: 'Blocked-by: #1, #2', labels: [] }],
    issues: { 1: { state: 'closed' }, 2: { state: 'closed' } },
  })
  await releaseReady(w)
  assert.equal(w.calls.addLabels.length, 1)
  assert.deepEqual(w.calls.addLabels[0].labels, ['delegate'])
  assert.equal(w.calls.comments.length, 1)
})

test('one blocker open → hold (no label, no comment)', async () => {
  const w = world({
    found: [{ number: 10, body: 'Blocked-by: #1, #2', labels: [] }],
    issues: { 1: { state: 'closed' }, 2: { state: 'open' } },
  })
  await releaseReady(w)
  assert.equal(w.calls.addLabels.length, 0)
  assert.ok(w.log.some(m => m.includes('blockers-open')))
})

test('already-dispatched dependent is skipped', async () => {
  const w = world({
    found: [{ number: 10, body: 'Blocked-by: #1', labels: lbl(['status:in-progress']) }],
    issues: { 1: { state: 'closed' } },
  })
  await releaseReady(w)
  assert.equal(w.calls.addLabels.length, 0)
})

test('onlyBlockedBy skips dependents that do not list that blocker', async () => {
  const w = world({
    found: [{ number: 10, body: 'Blocked-by: #1', labels: [] }],
    issues: { 1: { state: 'closed' } },
  })
  await releaseReady(w, { onlyBlockedBy: 99 })
  assert.equal(w.calls.addLabels.length, 0)
})

test('issue with no Blocked-by is ignored', async () => {
  const w = world({ found: [{ number: 10, body: 'nothing here', labels: [] }] })
  await releaseReady(w)
  assert.equal(w.calls.addLabels.length, 0)
})

function prWorld(body, issues) {
  const w = world({ issues })
  w.context.payload = {
    pull_request: { merged: true, body, base: { ref: 'main' } },
    repository: { default_branch: 'main' },
  }
  return w
}

test('closeLinkedIssues: zero Closes lines closes nothing', async () => {
  const w = prWorld('just prose', {})
  await closeLinkedIssues(w)
  assert.equal(w.calls.updates.length, 0)
})

test('closeLinkedIssues: one Closes line closes that issue', async () => {
  const w = prWorld('Closes #5', { 5: { state: 'open', labels: [] } })
  await closeLinkedIssues(w)
  assert.deepEqual(w.calls.updates.map(u => u.issue_number), [5])
})

test('closeLinkedIssues: several Closes lines close each; code spans and blocked issues are left alone', async () => {
  const w = prWorld('Closes #5\nCloses #6\nCloses #7\n`Closes #8`\n```\nCloses #9\n```', {
    5: { state: 'open', labels: [] },
    6: { state: 'closed', labels: [] },
    7: { state: 'open', labels: lbl(['status:blocked']) },
  })
  await closeLinkedIssues(w)
  assert.deepEqual(w.calls.updates.map(u => u.issue_number), [5])
})

test('closeLinkedIssues: unmerged PR does nothing', async () => {
  const w = prWorld('Closes #5', { 5: { state: 'open', labels: [] } })
  w.context.payload.pull_request.merged = false
  await closeLinkedIssues(w)
  assert.equal(w.calls.updates.length, 0)
})
