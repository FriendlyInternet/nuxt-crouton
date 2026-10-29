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
  assert.equal(kind({ comment: c('use `/close-epic` later'), issue: issue() }), 'interpret')
})

test('dispatch: a rocket or slash command from a collaborator', () => {
  assert.equal(kind({ comment: c('🚀'), issue: issue() }), 'dispatch')
  assert.equal(kind({ comment: c('/build'), issue: issue(['status:blocked']) }), 'dispatch')
  assert.equal(kind({ comment: c('/build', 'NONE'), issue: issue() }), 'none')
})

test('test-card: ok / not ok on a status:to-test card', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('not ok: broken'), issue: issue(['status:to-test']) }), 'test-card')
  assert.equal(kind({ comment: c('looks fine, thanks'), issue: issue(['status:to-test']) }), 'interpret')
})

test('resume: a reply on a blocked issue; an approval on an unblocked one is explain-only', () => {
  const blocked = routeComment({ comment: c('use blue instead'), issue: issue(['status:blocked', 'delegate-pi']) })
  assert.deepEqual([blocked.kind, blocked.blocked], ['resume', true])
  const open = routeComment({ comment: c('ok'), issue: issue() })
  assert.deepEqual([open.kind, open.blocked], ['resume', false])
  assert.equal(kind({ comment: c('use blue instead'), issue: issue() }), 'interpret')
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
  assert.equal(kind({ comment: c('make the header bigger'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
})

test('none: bots, "looks good", a non-approval word that contains ok', () => {
  assert.equal(kind({ comment: c('ok', 'NONE', 'Bot'), issue: prIssue, pr: pr() }), 'none')
  assert.equal(kind({ comment: c('looks good'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
  assert.equal(kind({ comment: c('looks good'), issue: issue() }), 'interpret')
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

test('interpret: only an owner\'s unmatched plain comment (#2980)', () => {
  assert.equal(kind({ comment: c('can we get a second opinion on this plan?'), issue: issue() }), 'interpret')
  assert.equal(kind({ comment: c('thanks', 'MEMBER'), issue: prIssue, pr: pr({ headRef: 'fix/other' }) }), 'interpret')
  // never: bots, non-owners, agent headers, slash commands, closed PRs
  assert.equal(kind({ comment: c('thanks', 'OWNER', 'Bot'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('thanks', 'COLLABORATOR'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('> 🤖 **Claude Code** · interactive agent\n\nFYI'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('/nonsense'), issue: issue() }), 'none')
  assert.equal(kind({ comment: c('thanks'), issue: prIssue, pr: pr({ headRef: 'fix/other', state: 'closed' }) }), 'none')
})

test('interpret never beats a fixed route', () => {
  assert.equal(kind({ comment: c('ok'), issue: issue(['status:blocked']) }), 'resume')
  assert.equal(kind({ comment: c('anything at all'), issue: issue(['status:blocked', 'delegate-pi']) }), 'resume')
  assert.equal(kind({ comment: c('**Worker:** fix it'), issue: prIssue, pr: pr() }), 'revise')
  assert.equal(kind({ comment: c('lgtm'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
  assert.equal(kind({ comment: c('🚀'), issue: issue() }), 'dispatch')
})

test('held tickets: pipeline-owned → resume, otherwise the owner\'s plain comment is interpreted (#2980)', () => {
  const held = ['status:blocked']
  const text = 'can we have a fresh pass on this plan?'
  assert.equal(kind({ comment: c(text), issue: { ...issue(held), body: 'plan\n<!-- pipeline: epic=1 -->' } }), 'resume')
  assert.equal(kind({ comment: c(text), issue: issue([...held, 'work-this']) }), 'resume')
  assert.equal(kind({ comment: c(text), issue: { ...issue(held), body: 'a held plan' } }), 'interpret')
  assert.equal(kind({ comment: c('ok'), issue: { ...issue(held), body: 'a held plan' } }), 'resume')
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
test('interpret: never for an app-posted comment, only revise via **Worker:**', () => {
  const viaClaude = { ...c('can we get a second opinion on this plan?', 'MEMBER'), performedViaGithubApp: 'Claude' }
  assert.equal(kind({ comment: viaClaude, issue: issue() }), 'none')
  const viaOther = { ...viaClaude, performedViaGithubApp: 'Some App' }
  assert.equal(kind({ comment: viaOther, issue: issue() }), 'none')
})
