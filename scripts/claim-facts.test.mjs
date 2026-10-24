/**
 * #2027 contract — the READ side of the claim guard.
 *
 * `decideClaim` was already tested, and still refused #1791 five times, because the two fields
 * that mattered were never GATHERED. These tests pin the gathering itself, against a fake
 * Octokit, so the missing-facts failure mode cannot come back silently in either lane.
 *
 *   node --test scripts/claim-facts.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gatherClaimFacts, referencesIssue } from './claim-facts.mjs'
import { decideClaim } from './pipeline-loop-guard.mjs'

const context = { repo: { owner: 'FriendlyInternet', repo: 'nuxt-crouton' }, payload: { repository: { default_branch: 'main' } } }

/** A fake Octokit: `prs` are both the search hits and what `pulls.get` returns. */
function fakeGithub({ issue = { state: 'open', labels: [] }, prs = [], events = [], pullsGetThrows = false } = {}) {
  return {
    paginate: async () => events,
    rest: {
      issues: {
        get: async () => ({ data: issue }),
        listEvents: async () => ({ data: events }),
      },
      search: {
        issuesAndPullRequests: async () => ({
          data: { items: prs.map((p) => ({ number: p.number, state: p.state, body: p.body, pull_request: { merged_at: p.mergedAt || null } })) },
        }),
      },
      pulls: {
        get: async ({ pull_number }) => {
          if (pullsGetThrows) throw new Error('boom')
          const p = prs.find((x) => x.number === pull_number)
          return { data: { head: { ref: p.headRef }, base: { ref: p.baseRef }, merged_at: p.mergedAt || null } }
        },
      },
    },
  }
}

test('referencesIssue matches closing keywords only', () => {
  assert.equal(referencesIssue('Closes #1791', 1791), true)
  assert.equal(referencesIssue('fixes #1791', 1791), true)
  assert.equal(referencesIssue('Resolved #1791', 1791), true)
  // A bare mention is not a claim — the PR merely talks about the issue.
  assert.equal(referencesIssue('related to #1791', 1791), false)
  // #17910 must not satisfy #1791.
  assert.equal(referencesIssue('Closes #17910', 1791), false)
})

test('the PR on work-<issue> is identified as OUR OWN — the half that was never gathered', async () => {
  const github = fakeGithub({ prs: [
    { number: 1987, state: 'open', body: 'Closes #1791', headRef: 'work-1791', baseRef: 'epic/1791-sales' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791 })
  assert.equal(facts.self.pr, 1987)
  assert.equal(facts.linkedPRs[0].baseRef, 'epic/1791-sales')
})

test('a PR from another branch is NOT ours', async () => {
  const github = fakeGithub({ prs: [
    { number: 1999, state: 'open', body: 'Closes #1791', headRef: 'somebody-else', baseRef: 'main' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791 })
  assert.equal(facts.self.pr, null)
})

test('end to end: the real #1791 shape now PROCEEDS', async () => {
  // PR #1987 merged into `epic/1791-…`, on our own `work-1791` branch. Both facts were absent
  // before #2027, and their absence refused this issue permanently.
  const github = fakeGithub({ prs: [
    { number: 1987, state: 'closed', body: 'Closes #1791', headRef: 'work-1791', baseRef: 'epic/1791-sales', mergedAt: '2026-08-05T23:50:18Z' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791 })
  assert.equal(decideClaim(facts).action, 'proceed')
})

test('end to end: a genuinely landed issue still REFUSES', async () => {
  // The loosening must not blind the guard — this is the case #1890 exists for.
  const github = fakeGithub({ prs: [
    { number: 2011, state: 'closed', body: 'Closes #1735', headRef: 'work-1735', baseRef: 'main', mergedAt: '2026-08-05T22:00:00Z' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1735 })
  // Our own branch, but it landed on main: the work is done, so this must NOT be exempted.
  const v = decideClaim({ ...facts, self: { pr: null } })
  assert.equal(v.action, 'refuse')
})

test('end to end: a competing OPEN pr still refuses', async () => {
  const github = fakeGithub({ prs: [
    { number: 1987, state: 'open', body: 'Closes #1791', headRef: 'work-1791', baseRef: 'epic/1791-sales' },
    { number: 1999, state: 'open', body: 'Closes #1791', headRef: 'someone-else', baseRef: 'main' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791 })
  const v = decideClaim(facts)
  assert.equal(v.action, 'refuse')
  assert.equal(v.claimedBy, 1999)
})

test('an unfetchable PR leaves baseRef null and stays REFUSED — fail safe, not fail open', async () => {
  const github = fakeGithub({
    prs: [{ number: 1987, state: 'closed', body: 'Closes #1791', mergedAt: '2026-08-05T23:50:18Z' }],
    pullsGetThrows: true,
  })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791, core: { warning() {} } })
  assert.equal(facts.linkedPRs[0].baseRef, null)
  assert.equal(decideClaim(facts).action, 'refuse')
})

test('a PR that only MENTIONS the issue is not gathered at all', async () => {
  const github = fakeGithub({ prs: [
    { number: 2000, state: 'open', body: 'see #1791 for context', headRef: 'x', baseRef: 'main' },
  ] })
  const facts = await gatherClaimFacts({ github, context, issueNumber: 1791 })
  assert.equal(facts.linkedPRs.length, 0)
  assert.equal(decideClaim(facts).action, 'proceed')
})

test('the default branch is read from the event payload, not hardcoded', async () => {
  const github = fakeGithub()
  const facts = await gatherClaimFacts({ github, context: { ...context, payload: { repository: { default_branch: 'trunk' } } }, issueNumber: 1 })
  assert.equal(facts.defaultBranch, 'trunk')
  // …and falls back when the payload carries no repository (workflow_dispatch).
  const bare = await gatherClaimFacts({ github, context: { repo: context.repo }, issueNumber: 1 })
  assert.equal(bare.defaultBranch, 'main')
})

test('status:in-progress contributes its timestamp only when the label is present', async () => {
  const events = [{ event: 'labeled', label: { name: 'status:in-progress' }, created_at: '2026-08-06T00:00:00Z' }]
  const without = await gatherClaimFacts({ github: fakeGithub({ events }), context, issueNumber: 1 })
  assert.equal(without.inProgressSince, null)

  const withLabel = await gatherClaimFacts({
    github: fakeGithub({ issue: { state: 'open', labels: [{ name: 'status:in-progress' }] }, events }),
    context, issueNumber: 1,
  })
  assert.equal(withLabel.inProgressSince, '2026-08-06T00:00:00Z')
})
