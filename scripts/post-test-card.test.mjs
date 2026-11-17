// findFixDeployed (#4039) — is the latest `not ok` fix of a status:failed epic live on staging?
// Fetchers are injected, so no network; the fixtures mirror the live #2804 / #3046 / #3805 shapes.
//   node --test scripts/post-test-card.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findFixDeployed } from './post-test-card.mjs'

const SHA = '56cab5998f4bd02e0969489841943ceafedfc5b2'
const fixIssue = { number: 3046, state: 'closed', title: 'Fix: test of #2804 failed — tested on velo staging', closed_at: '2026-11-12T12:18:13Z' }
const children = [
  { number: 2839, state: 'closed', title: 'Step one', closed_at: '2026-10-20T10:00:00Z' },
  fixIssue
]
const xref = (n, mergedAt) => ({ event: 'cross-referenced', source: { issue: { number: n, pull_request: { merged_at: mergedAt } } } })
const timeline3046 = [
  { event: 'closed', commit_id: null },
  xref(3805, '2026-11-12T12:18:12Z')
]
const pulls = { 3805: { number: 3805, base: { ref: 'main' }, merge_commit_sha: SHA } }

test('T5: fix PR merged to main and contained in the deployed sha → fixDeployed', async () => {
  const r = await findFixDeployed({ epicNumber: 2804, subIssues: children, timeline: async () => timeline3046, pull: async n => pulls[n], isContained: async s => s === SHA })
  assert.equal(r.fixDeployed, true)
  assert.equal(r.fixIssue, 3046)
  assert.equal(r.fixClosedAt, '2026-11-12T12:18:13Z')
  assert.equal(r.sha, SHA)
  assert.match(r.reason, /56cab59 \(#3805\) is on staging/)
})

test('T6: same PR but not in the deployed sha → not deployed', async () => {
  const r = await findFixDeployed({ epicNumber: 2804, subIssues: children, timeline: async () => timeline3046, pull: async n => pulls[n], isContained: async () => false })
  assert.equal(r.fixDeployed, false)
  assert.match(r.reason, /not in the deployed sha yet/)
})

test('T7: only an unmerged PR and an epic-branch PR → fix closed without a merge to main', async () => {
  const tl = [
    { event: 'cross-referenced', source: { issue: { number: 3800, pull_request: { merged_at: null } } } },
    xref(3801, '2026-11-12T11:00:00Z')
  ]
  const pr = { 3800: { number: 3800, base: { ref: 'main' }, merge_commit_sha: null }, 3801: { number: 3801, base: { ref: 'epic/2804-x' }, merge_commit_sha: 'abc' } }
  const seen = []
  const r = await findFixDeployed({ epicNumber: 2804, subIssues: children, timeline: async () => tl, pull: async n => (seen.push(n), pr[n]), isContained: async () => true })
  assert.equal(r.fixDeployed, false)
  assert.equal(r.reason, 'fix closed without a merge to main')
  assert.deepEqual(seen, [3801])
})

test('T8: a non-fix child that closed later is ignored; the Fix: test of #N failed one is used', async () => {
  const later = { number: 3999, state: 'closed', title: 'Something else', closed_at: '2026-11-15T00:00:00Z' }
  const asked = []
  const r = await findFixDeployed({ epicNumber: 2804, subIssues: [...children, later], timeline: async n => (asked.push(n), timeline3046), pull: async n => pulls[n], isContained: async () => true })
  assert.deepEqual(asked, [3046])
  assert.equal(r.fixIssue, 3046)
  const none = await findFixDeployed({ epicNumber: 2804, subIssues: [later], timeline: async () => [], pull: async () => null, isContained: async () => true })
  assert.equal(none.fixDeployed, false)
  assert.match(none.reason, /no "Fix: test of #2804 failed" sub-issue/)
})
