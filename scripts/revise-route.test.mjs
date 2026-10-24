import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workIssueFromRef, shouldRevise, routePrComment } from './revise-route.mjs'

const owner = (body, extra = {}) => ({ body, authorAssociation: 'OWNER', userType: 'User', ...extra })

test('workIssueFromRef reads only pi worker branches', () => {
  assert.equal(workIssueFromRef('work-2414'), 2414)
  assert.equal(workIssueFromRef('fix/2433-capture'), null)
  assert.equal(workIssueFromRef('work-2414-extra'), null)
  assert.equal(workIssueFromRef(undefined), null)
})

test('a plain change request from the owner revises', () => {
  assert.equal(shouldRevise(owner('delete the leftover composable in crouton-sales')).revise, true)
})

test('approvals, agent comments, commands and bots do not revise', () => {
  assert.equal(shouldRevise(owner('lgtm')).revise, false)
  assert.equal(shouldRevise(owner('✅')).revise, false)
  assert.equal(shouldRevise(owner('> 🤖 **Claude Code** · interactive agent · …\n\nstatus')).revise, false)
  assert.equal(shouldRevise(owner('> 🤖 **pi.dev harness** · agent pipeline (CI) · …\n\n**Worker:** do X')).revise, false)
  assert.equal(shouldRevise(owner('/close-epic')).revise, false)
  assert.equal(shouldRevise(owner('🚀')).revise, false)
  assert.equal(shouldRevise(owner('   ')).revise, false)
  assert.equal(shouldRevise(owner('fix it', { userType: 'Bot' })).revise, false)
  assert.equal(shouldRevise(owner('fix it', { authorAssociation: 'NONE' })).revise, false)
})

test('one definition of approval: any lgtm releases, so it never also revises', () => {
  // approval.mjs counts this as an approval and approve-draft-pr acts on it — revising too
  // would fire two workflows on one comment.
  assert.equal(shouldRevise(owner('lgtm but make the button bigger first')).revise, false)
})

test('routePrComment needs an open work-<N> PR', () => {
  const c = owner('rename the prop')
  assert.deepEqual(routePrComment({ pr: { headRef: 'work-7', state: 'open' }, comment: c }).issue, 7)
  assert.equal(routePrComment({ pr: { headRef: 'work-7', state: 'open' }, comment: c }).revise, true)
  assert.equal(routePrComment({ pr: { headRef: 'work-7', state: 'closed' }, comment: c }).revise, false)
  assert.equal(routePrComment({ pr: { headRef: 'feat/x', state: 'open' }, comment: c }).revise, false)
})

test('an interactive-agent comment that addresses the worker revises (#2453)', () => {
  const body = '> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`\'s account (not Maarten) · _change request_\n\n👀 **review** — not lgtm yet.\n**Worker:** add the preview page and push.\n'
  const d = shouldRevise(owner(body))
  assert.equal(d.revise, true)
  assert.match(d.reason, /addressed to the worker/)
})
