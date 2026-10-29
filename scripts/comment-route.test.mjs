import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeComment, KINDS } from './comment-route.mjs'

const c = (body, authorAssociation = 'OWNER', userType = 'User') => ({ body, authorAssociation, userType })
const issue = (labels = []) => ({ number: 7, isPr: false, labels })
const pr = (o = {}) => ({ headRef: 'work-7', baseRef: 'epic/1-x', draft: false, state: 'open', ...o })
const prIssue = { number: 7, isPr: true, labels: [] }
const kind = (input) => routeComment(input).kind

test('every kind the workflow switches on is declared', () => {
  assert.equal(KINDS.length, 10)
})

test('close-epic: /close-epic on an issue', () => {
  assert.equal(kind({ comment: c('/close-epic'), issue: issue() }), 'close-epic')
  assert.equal(kind({ comment: c('use `/close-epic` later'), issue: issue() }), 'none')
})

test('dispatch: a rocket or slash command from a collaborator', () => {
  assert.equal(kind({ comment: c('🚀'), issue: issue() }), 'dispatch')
  assert.equal(kind({ comment: c('/build'), issue: issue(['status:blocked']) }), 'dispatch')
  assert.equal(kind({ comment: c('/build', 'NONE'), issue: issue() }), 'none')
})

test('test-card: ok / not ok on a status:to-test card', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('not ok: broken'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('looks fine, thanks'), issue: issue(['status:to-test']) }), 'none')
})

test('resume: a reply on a blocked issue; an approval on an unblocked one is explain-only', () => {
  const blocked = routeComment({ comment: c('use blue instead'), issue: issue(['status:blocked']) })
  assert.deepEqual([blocked.kind, blocked.blocked], ['resume', true])
  const open = routeComment({ comment: c('ok'), issue: issue() })
  assert.deepEqual([open.kind, open.blocked], ['resume', false])
  assert.equal(kind({ comment: c('use blue instead'), issue: issue() }), 'none')
})

test('approve-draft: approval on a draft PR', () => {
  assert.equal(kind({ comment: c('✅'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
})

test('approve-epic: owner approval on a ready epic → main PR', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})

test('automerge-go: approval on a ready leaf PR', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr() }), 'automerge-go')
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'work-7', baseRef: 'main' }) }), 'automerge-go')
})

test('revise: a change request on a pi branch', () => {
  assert.equal(kind({ comment: c('make the header bigger'), issue: prIssue, pr: pr() }), 'revise')
  assert.equal(kind({ comment: c('make the header bigger'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'none')
})

test('none: bots, "looks good", a non-approval word that contains ok', () => {
  assert.equal(kind({ comment: c('ok', 'NONE', 'Bot'), issue: prIssue, pr: pr() }), 'none')
  assert.equal(kind({ comment: c('looks good'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'none')
  assert.equal(kind({ comment: c('looks good'), issue: issue() }), 'none')
})

// The four races from the audit: each comment must start exactly ONE acting job.
test('race: bare ok on a draft PR releases it and does not also run automerge', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
})
test('race: bare ok on an epic PR merges once (approve-epic, never automerge-go)', () => {
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})
test('race: lgtm on an epic PR merges once', () => {
  assert.equal(kind({ comment: c('lgtm'), issue: prIssue, pr: pr({ headRef: 'epic/9-x', baseRef: 'main' }) }), 'approve-epic')
})
test('race: ok on an issue with both status:blocked and status:to-test answers the card only', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:blocked', 'status:to-test']) }), 'test-card')
})

test('revise: an interactive-agent **Worker:** request (posted via the Claude app as a User) routes (#3029)', () => {
  const body = '> 🤖 **Claude Code** · interactive agent · posted from pmcp\n\n**Worker:** rename the header'
  const viaClaude = { ...c(body, 'MEMBER'), performedViaGithubApp: 'Claude' }
  assert.equal(kind({ comment: viaClaude, issue: prIssue, pr: pr() }), 'revise')
})
test('none: a comment posted via any other GitHub App is dropped, even under a User identity', () => {
  const body = '**Worker:** rename the header'
  const viaOther = { ...c(body, 'MEMBER'), performedViaGithubApp: 'Some App' }
  assert.equal(kind({ comment: viaOther, issue: prIssue, pr: pr() }), 'none')
})

test('approve-plan: owner ok on a plan held after two rejections; anything else resumes', () => {
  const held = { ...issue(['status:blocked']), planHeld: true }
  assert.equal(kind({ comment: c('ok'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('lgtm'), issue: held }), 'approve-plan')
  assert.equal(kind({ comment: c('ok', 'CONTRIBUTOR'), issue: held }), 'resume')
  assert.equal(kind({ comment: c('use blue instead'), issue: held }), 'resume')
  assert.equal(kind({ comment: c('ok'), issue: { ...issue(['status:blocked']), planHeld: false } }), 'resume')
})
