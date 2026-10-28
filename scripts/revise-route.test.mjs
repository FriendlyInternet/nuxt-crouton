// layer: stack
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

test('an epic/<N>-… head routes to a revise on that branch (#2875)', () => {
  const c = owner('**Worker:** bring this branch up to date with main')
  const r = routePrComment({ pr: { headRef: 'epic/2754-plan-before-build', state: 'open' }, comment: c })
  assert.equal(r.revise, true)
  assert.equal(r.issue, 2754)
  assert.equal(r.branch, 'epic/2754-plan-before-build')
  assert.equal(routePrComment({ pr: { headRef: 'work-12', state: 'open' }, comment: c }).branch, '')
  assert.equal(routePrComment({ pr: { headRef: 'feature/x', state: 'open' }, comment: c }).revise, false)
})

test('an interactive-agent comment that addresses the worker revises (#2453)', () => {
  const body = '> 🤖 **Claude Code** · interactive agent · posted from `@pmcp`\'s account (not Maarten) · _change request_\n\n👀 **review** — not lgtm yet.\n**Worker:** add the preview page and push.\n'
  const d = shouldRevise(owner(body))
  assert.equal(d.revise, true)
  assert.match(d.reason, /addressed to the worker/)
})

test('a skipped 🛠 action comment with no **Worker:** line earns a reply; status comments do not (#2707)', () => {
  const head = "> 🤖 **Claude Code** · interactive agent · _x_\n\n"
  const act = shouldRevise(owner(head + '🛠 **action** — please add the page\n'))
  assert.equal(act.revise, false)
  assert.equal(act.reply, true)
  assert.equal(Boolean(shouldRevise(owner(head + '✅ **done** — shipped\n')).reply), false)
  assert.equal(Boolean(shouldRevise(owner(head + '👀 **review**\n')).reply), false)
  // addressed to the worker → revises, no "ignored" reply
  const addressed = shouldRevise(owner(head + '🛠 **action**\n**Worker:** do X\n'))
  assert.equal(addressed.revise, true)
  assert.equal(Boolean(addressed.reply), false)
  // pipeline comments never get one
  assert.equal(Boolean(shouldRevise(owner('> 🤖 **pi.dev harness** · agent pipeline (CI)\n\n🛠 **action**')).reply), false)
  const pr = { headRef: 'work-7', state: 'open' }
  assert.equal(routePrComment({ pr, comment: owner(head + '🛠 act') }).reply, true)
})
