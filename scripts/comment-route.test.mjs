import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeComment, KINDS } from './comment-route.mjs'

const c = (body, authorAssociation = 'OWNER', userType = 'User') => ({ body, authorAssociation, userType })
const issue = (labels = []) => ({ number: 7, isPr: false, labels })
const pr = (o = {}) => ({ headRef: 'work-7', baseRef: 'epic/1-x', draft: false, state: 'open', ...o })
const prIssue = { number: 7, isPr: true, labels: [] }
const kind = (input) => routeComment(input).kind

test('every kind the workflow switches on is declared', () => {
  assert.equal(KINDS.length, 9)
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

// #3033 — app-posted comments (the interactive agent) may only revise
const AGENT = '> 🤖 **Claude Code** · interactive agent · _ctx_\n\n**Worker:** please fix the label'
const viaApp = (body, input = {}) => routeComment({ comment: c(body), issue: prIssue, pr: pr(), performedViaApp: true, ...input })

test('app-posted: an interactive **Worker:** request on a pipeline PR revises', () => {
  assert.equal(viaApp(AGENT).kind, 'revise')
  assert.equal(viaApp(AGENT, { pr: pr({ headRef: 'epic/3-x', baseRef: 'main' }) }).kind, 'revise')
})

test('app-posted: plain issue or no **Worker:** line → none', () => {
  assert.equal(viaApp(AGENT, { issue: issue(['status:blocked']), pr: undefined }).kind, 'none')
  assert.equal(viaApp('> 🤖 **Claude Code** · interactive agent\n\nFYI done').kind, 'none')
})

test('app-posted: never an approval/merge/close/dispatch/resume kind', () => {
  for (const body of ['ok', 'lgtm', '✅', '/close-epic', '🚀', '/build']) {
    assert.equal(viaApp(body).kind, 'none', body)
    assert.equal(viaApp(body, { issue: issue(['status:blocked']), pr: undefined }).kind, 'none', body)
  }
  assert.equal(viaApp(`${AGENT}\nok`, { pr: pr({ draft: true }) }).kind, 'revise')
})

test('app-posted: bots and pipeline comments stay none; hand-typed comments unchanged', () => {
  assert.equal(routeComment({ comment: c(AGENT, 'OWNER', 'Bot'), issue: prIssue, pr: pr(), performedViaApp: true }).kind, 'none')
  assert.equal(viaApp('> 🤖 **pi.dev harness** · agent pipeline (CI)\n\n**Worker:** x').kind, 'none')
  assert.equal(kind({ comment: c('ok'), issue: prIssue, pr: pr({ draft: true }) }), 'approve-draft')
})
