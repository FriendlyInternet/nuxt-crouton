import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runEpicReadyPr } from './epic-ready-pr.mjs'

const BLOCK = (epic, branch) => `<!-- pipeline: epic=${epic} epic_branch=${branch} -->`

// Fake github-script world. `o.subIssues`, `o.merged`, `o.files[n]` (value or Error), etc.
function world(o = {}) {
  const calls = { create: [], review: [] }
  const log = [], warns = [], failed = []
  const o2 = { subIssues: [{ number: 1, state: 'closed', title: 'a' }, { number: 2, state: 'closed', title: 'b' }], merged: [], files: {}, comments: {}, existing: [], ahead: 3, refs: [], ...o }
  const fn = name => { const f = () => {}; f.n = name; return f }
  const rest = {
    pulls: { list: fn('list'), listFiles: fn('listFiles'), listReviews: fn('listReviews'),
      create: async a => { if (o2.createThrows) throw new Error('boom'); calls.create.push(a); return { data: { number: 99 } } },
      requestReviewers: async a => { if (o2.reviewThrows) throw new Error('nope'); calls.review.push(a) } },
    issues: { listComments: fn('listComments'), get: async () => ({ data: { title: 'Epic: T', body: '' } }) },
    repos: { compareCommitsWithBasehead: async () => { if (o2.compareThrows) throw new Error('cmp'); return { data: { ahead_by: o2.ahead } } } },
  }
  const github = {
    rest,
    paginate: async (f, a) => {
      if (typeof f === 'string') return f.includes('matching-refs') ? o2.refs : o2.subIssues
      if (f === rest.pulls.list) return a.state === 'open' ? o2.existing : o2.merged
      if (f === rest.pulls.listFiles) { const v = o2.files[a.pull_number]; if (v instanceof Error) throw v; return (v || []).map(filename => ({ filename })) }
      if (f === rest.issues.listComments) return o2.comments[a.issue_number] || []
      return []
    },
  }
  const core = { info: m => log.push(m), warning: m => warns.push(m), setFailed: m => failed.push(m) }
  const context = { repo: { owner: 'o', repo: 'r' }, eventName: o2.event || 'issues', payload: { issue: o2.issue } }
  return { github, core, context, calls, log, warns, failed }
}
const run = (w, extra) => runEpicReadyPr(w, { ownerLogin: 'pmcp', ...extra })
const child = { number: 1, body: BLOCK(7, 'epic/7-x') }

test('dispatch with no epic number → skip', async () => {
  const w = world({ event: 'workflow_dispatch' })
  await run(w, { dispatchBranch: 'feature/x' })
  assert.equal(w.calls.create.length, 0)
  assert.ok(w.log.some(m => m.includes('could not resolve an epic number')))
})
test('closed child with block → opens PR and requests owner review', async () => {
  const w = world({ issue: child })
  await run(w)
  assert.equal(w.calls.create.length, 1)
  assert.equal(w.calls.create[0].head, 'epic/7-x')
  assert.equal(w.calls.create[0].base, 'main')
  assert.deepEqual(w.calls.review[0].reviewers, ['pmcp'])
})
test('no branch in block → matching-refs; none found → skip', async () => {
  const w = world({ issue: { number: 1, body: '<!-- pipeline: epic=7 -->' } })
  await run(w)
  assert.ok(w.log.includes('no epic branch for #7; skip.'))
  const w2 = world({ issue: { number: 1, body: '<!-- pipeline: epic=7 -->' }, refs: [{ ref: 'refs/heads/epic/7-y' }] })
  await run(w2)
  assert.equal(w2.calls.create[0].head, 'epic/7-y')
})
test('genuine epic closing itself → skip', async () => {
  const w = world({ issue: { number: 7, body: BLOCK(7, 'epic/7-x') } })
  await run(w)
  assert.equal(w.calls.create.length, 0)
  assert.ok(w.log.some(m => m.includes('closed via /close-epic')))
})
test('solo leaf → opens with one child', async () => {
  const w = world({ issue: { number: 7, body: BLOCK(7, 'epic/7-x') }, subIssues: [] })
  await run(w)
  assert.equal(w.calls.create.length, 1)
  assert.ok(w.calls.create[0].body.includes('**Children (1):**'))
  assert.ok(w.calls.create[0].body.includes('- #7 undefined')) // quirk preserved — see #3619
})
test('existing open PR → idempotent', async () => {
  const w = world({ issue: child, existing: [{ number: 5 }] })
  await run(w)
  assert.equal(w.calls.create.length, 0)
})
test('compare throws → warning, no create', async () => {
  const w = world({ issue: child, compareThrows: true })
  await run(w)
  assert.equal(w.calls.create.length, 0)
  assert.ok(w.warns.some(m => m.startsWith('compare main...epic/7-x')))
})
test('gather throws on first sub-PR → warns, opens with no carry', async () => {
  const w = world({ issue: child, merged: [{ number: 11, merged_at: 'x', body: '' }], files: { 11: new Error('api') } })
  await run(w)
  assert.ok(w.warns.includes('sub-PR approval gather for epic/7-x: api — the shared-code check will ask'))
  const body = w.calls.create[0].body
  assert.ok(!body.includes('Packages-approved') && !body.includes('🔒'))
})
test('create throws → setFailed', async () => {
  const w = world({ issue: child, createThrows: true })
  await run(w)
  assert.ok(w.failed.some(m => m.startsWith('create epic→main PR failed')))
})
test('requestReviewers throws → warning only', async () => {
  const w = world({ issue: child, reviewThrows: true })
  await run(w)
  assert.equal(w.calls.create.length, 1)
  assert.equal(w.failed.length, 0)
  assert.ok(w.warns.some(m => m.startsWith('requestReviewers @pmcp')))
})
test('approved-then-throw withholds the approval (partial gather)', async () => {
  // #3659: a partial gather never declares
  const w = world({
    issue: child,
    merged: [{ number: 11, merged_at: 'x', body: '' }, { number: 12, merged_at: 'x', body: '' }],
    files: { 11: ['packages/x/a.ts'], 12: new Error('api') },
    comments: { 11: [{ user: { login: 'pmcp' }, body: 'ok' }] },
  })
  await run(w)
  assert.ok(w.warns.some(m => m.includes('sub-PR approval gather for epic/7-x')))
  const body = w.calls.create[0].body
  // the 🔒 section itself mentions "a `Packages-approved:` line", so match the declaration form
  assert.ok(!body.includes('Packages-approved: owner approved'))
  assert.ok(body.includes('🔒 Shared code not yet signed off'))
  assert.ok(body.includes('#12'))
  assert.ok(w.log.some(m => m.includes('incomplete=true')))
})
test('full gather with all packages PRs approved → declares', async () => {
  const w = world({
    issue: child,
    merged: [{ number: 11, merged_at: 'x', body: '' }, { number: 12, merged_at: 'x', body: '' }],
    files: { 11: ['packages/x/a.ts'], 12: ['packages/y/b.ts'] },
    comments: { 11: [{ user: { login: 'pmcp' }, body: 'ok' }], 12: [{ user: { login: 'pmcp' }, body: 'ok' }] },
  })
  await run(w)
  assert.equal(w.warns.length, 0)
  const body = w.calls.create[0].body
  assert.ok(body.includes('Packages-approved: owner approved #11, #12'))
  assert.ok(!body.includes('🔒'))
})
