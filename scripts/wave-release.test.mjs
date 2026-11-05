import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseReady, closeLinkedIssues, mayCloseHeldIssue } from './wave-release.mjs'

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

test('closeLinkedIssues: build:approved PR closes an issue left status:blocked by an earlier no-go', async () => {
  const w = prWorld('Closes #7', { 7: { state: 'open', labels: lbl(['status:blocked']) } })
  w.context.payload.pull_request.labels = [{ name: 'build:approved' }]
  await closeLinkedIssues(w)
  assert.deepEqual(w.calls.updates.map(u => u.issue_number), [7])
})

for (const [name, mergedBy, expected] of [
  ['owner merge closes a held issue (replay #3124 → #3077)', { login: 'pmcp' }, [3077]],
  ['bot merge keeps the hold', { login: 'nuxt-harness[bot]' }, []],
  ['absent merged_by keeps the hold', undefined, []],
]) {
  test(`closeLinkedIssues: ${name}`, async () => {
    const w = prWorld('Closes #3077', { 3077: { state: 'open', labels: lbl(['status:blocked']) } })
    w.context.payload.pull_request.merged_by = mergedBy
    await closeLinkedIssues(w)
    assert.deepEqual(w.calls.updates.map(u => u.issue_number), expected)
  })
}

test('closeLinkedIssues: unmerged PR does nothing', async () => {
  const w = prWorld('Closes #5', { 5: { state: 'open', labels: [] } })
  w.context.payload.pull_request.merged = false
  await closeLinkedIssues(w)
  assert.equal(w.calls.updates.length, 0)
})

const held = [{ name: 'status:blocked' }]
const may = (o) => mayCloseHeldIssue({ labels: [], prLabels: [], mergedBy: 'bot', owner: 'pmcp', ...o })
test('mayCloseHeldIssue: unheld issue closes', () => assert.equal(may({}), true))
test('mayCloseHeldIssue: bot merge keeps the hold', () => assert.equal(may({ labels: held }), false))
test('mayCloseHeldIssue: missing mergedBy keeps the hold', () => assert.equal(may({ labels: held, mergedBy: undefined }), false))
test('mayCloseHeldIssue: owner merge closes a held issue', () => assert.equal(may({ labels: held, mergedBy: 'pmcp' }), true))
test('mayCloseHeldIssue: build:approved closes a held issue', () => assert.equal(may({ labels: held, prLabels: ['build:approved'] }), true))

// #3368: a bot merge driven by the owner's `ok` on the PR releases the hold.
const OK = { user: { login: 'pmcp', type: 'User' }, body: 'ok', created_at: '2026-11-04T19:58:32Z' }
const commitAt = (d, parents = [1]) => ({ parents, commit: { committer: { date: d } } })
function okWorld({ comments = [OK], commits = [commitAt('2026-11-04T19:00:00Z')], throws = false } = {}) {
  const w = prWorld('Closes #3131', { 3131: { state: 'open', labels: lbl(['status:blocked']) } })
  w.context.payload.pull_request.number = 3192
  w.context.payload.pull_request.merged_by = { login: 'nuxt-harness[bot]' }
  w.fetched = 0
  w.github.rest.pulls.listCommits = () => 'commits'
  w.github.rest.issues.listComments = () => 'comments'
  w.github.paginate = async fn => {
    w.fetched++
    if (throws) throw new Error('boom')
    return fn() === 'commits' ? commits : comments
  }
  return w
}
test('mayCloseHeldIssue: owner ok on the PR closes a held issue (bot merge)', () => assert.equal(may({ labels: held, ownerGo: true }), true))
test('closeLinkedIssues: held issue + owner ok comment → closes', async () => {
  const w = okWorld(); await closeLinkedIssues(w)
  assert.deepEqual(w.calls.updates.map(u => [u.issue_number, u.state]), [[3131, 'closed']])
})
test('closeLinkedIssues: held issue + owner ok voided by a later worker commit → stays open', async () => {
  const w = okWorld({ commits: [commitAt('2026-11-04T20:00:00Z')] }); await closeLinkedIssues(w)
  assert.equal(w.calls.updates.length, 0)
})
test('closeLinkedIssues: held issue, comments fetch throws → stays open', async () => {
  const w = okWorld({ throws: true }); await closeLinkedIssues(w)
  assert.equal(w.calls.updates.length, 0)
})
test('closeLinkedIssues: unheld issue → no comment fetch', async () => {
  const w = okWorld(); w.context.payload.pull_request.body = 'Closes #5'
  w.github.rest.issues.get = async () => ({ data: { state: 'open', labels: [] } })
  await closeLinkedIssues(w)
  assert.equal(w.fetched, 0)
  assert.equal(w.calls.updates.length, 1)
})
