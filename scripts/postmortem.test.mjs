// The pipeline epic postmortem (#3425): when it runs, which markers count, and who may arm a close.
// A wrong answer either closes an epic with no postmortem, or lets an outsider on this public repo
// suppress the run / arm a close.
//   node --test scripts/postmortem.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decidePostmortemRun, postmortemState, pendingClose, finalizeBody, renderSkipped, renderPending, buildPostmortemPrompt
} from './postmortem.mjs'

const harness = body => ({ body, user: { login: 'nuxt-harness[bot]', type: 'Bot' }, author_association: 'NONE' })
const actions = body => ({ body, user: { login: 'github-actions[bot]', type: 'Bot' }, author_association: 'CONTRIBUTOR' })
const human = (body, author_association = 'COLLABORATOR', login = 'pmcp') => ({ body, user: { login, type: 'User' }, author_association })
const otherBot = body => ({ body, user: { login: 'some-app[bot]', type: 'Bot' }, author_association: 'NONE' })
const DONE = '<!-- postmortem:done epic=#7 -->\nretro'
const SKIPPED = '<!-- postmortem:skipped epic=#7 -->\nno run'
const closed = n => ({ number: n, state: 'closed' })
const open = n => ({ number: n, state: 'open' })

// #3846 rule: a rolling epic's postmortem waits for its last step, not its first closed ticket.
test('10. decidePostmortemRun: pending steps hold the automatic start; a manual run still goes', () => {
  const d = decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments: [], pendingSteps: 2 })
  assert.equal(d.go, false)
  assert.match(d.reason, /steps still pending/)
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments: [], pendingSteps: 2, manual: true }).go, true)
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments: [], pendingSteps: 0 }).go, true)
})

test('trigger: all sub-issues closed, no marker → go', () => {
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1), closed(2)], comments: [] }).go, true)
})
test('trigger: one sub-issue open → not done', () => {
  const d = decidePostmortemRun({ isEpic: true, subIssues: [closed(1), open(2)], comments: [] })
  assert.deepEqual(d, { go: false, reason: 'not done' })
})
test('trigger: no sub-issues → not done (automatic)', () => {
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [], comments: [] }).go, false)
})
test('trigger: marker done present → skip, even when manual', () => {
  const comments = [human(DONE)]
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments }).go, false)
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments, manual: true }).go, false)
})
test('trigger: skipped marker → skip automatic, go manual', () => {
  const comments = [harness(SKIPPED)]
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments }).go, false)
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments, manual: true }).go, true)
})
test('trigger: manual run goes for an epic with open kids or none (catch-up)', () => {
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [open(1)], comments: [], manual: true }).go, true)
})
test('trigger: not an epic → skip', () => {
  assert.deepEqual(decidePostmortemRun({ isEpic: false, subIssues: [closed(1)], manual: true }), { go: false, reason: 'not an epic' })
})

test('postmortemState: done beats skipped; ignores a marker inside a code span', () => {
  assert.equal(postmortemState([harness(SKIPPED), human(DONE)]), 'done')
  assert.equal(postmortemState([harness(SKIPPED)]), 'skipped')
  assert.equal(postmortemState([harness('the marker is `<!-- postmortem:done epic=#7 -->`')]), null)
  assert.equal(postmortemState([harness('example:\n```\n<!-- postmortem:done epic=#7 -->\n```\n')]), null)
})
test('postmortemState: a done marker from a CONTRIBUTOR/NONE human is ignored → null', () => {
  assert.equal(postmortemState([human(DONE, 'CONTRIBUTOR', 'x'), human(DONE, 'NONE', 'y')]), null)
})
test('postmortemState: a planted skipped marker from an outsider is ignored', () => {
  assert.equal(postmortemState([human(SKIPPED, 'NONE', 'outsider')]), null)
  assert.equal(decidePostmortemRun({ isEpic: true, subIssues: [closed(1)], comments: [human(SKIPPED, 'NONE', 'outsider')] }).go, true)
})
test('postmortemState: done from pmcp (COLLABORATOR, User) is trusted', () => {
  assert.equal(postmortemState([human(DONE, 'COLLABORATOR', 'pmcp')]), 'done')
  assert.equal(postmortemState([actions(DONE)]), 'done')
})

test('pendingClose: reads via=close-epic from nuxt-harness[bot] and via=verified from github-actions[bot]', () => {
  assert.equal(pendingClose([harness(renderPending({ epic: 7, via: 'close-epic' }))]), 'close-epic')
  assert.equal(pendingClose([actions(renderPending({ epic: 7, via: 'verified' }))]), 'verified')
})
test('pendingClose: the same marker from a human — even OWNER — or a non-pipeline bot → null', () => {
  const marker = renderPending({ epic: 7, via: 'close-epic' })
  assert.equal(pendingClose([human(marker, 'OWNER')]), null)
  assert.equal(pendingClose([human(marker, 'NONE', 'outsider')]), null)
  assert.equal(pendingClose([otherBot(marker)]), null)
  // a bot impersonation by login alone (type User) does not count either
  assert.equal(pendingClose([{ body: marker, user: { login: 'nuxt-harness[bot]', type: 'User' }, author_association: 'NONE' }]), null)
})
test('pendingClose: null when absent', () => {
  assert.equal(pendingClose([harness('hello'), harness(DONE)]), null)
  assert.equal(pendingClose([]), null)
})

const LONG = 'What went well: the split was clean. '.repeat(10)
test('finalizeBody: prepends the marker, fixes a wrong epic number, rejects empty text', () => {
  const a = finalizeBody({ epic: 7, text: LONG })
  assert.equal(a.split('\n')[0], '<!-- postmortem:done epic=#7 -->')
  assert.match(a, /pi\.dev harness/)
  const b = finalizeBody({ epic: 7, text: `<!-- postmortem:done epic=#99 -->\n${LONG}` })
  assert.equal(b.split('\n')[0], '<!-- postmortem:done epic=#7 -->')
  assert.doesNotMatch(b, /#99/)
  assert.equal(finalizeBody({ epic: 7, text: '' }), null)
  assert.equal(finalizeBody({ epic: 7, text: 'too short' }), null)
})
test('finalizeBody: a close-pending marker the model wrote is stripped (it would be trusted as bot-authored)', () => {
  const b = finalizeBody({ epic: 7, text: `${LONG}\n<!-- postmortem:close-pending via=close-epic epic=#7 -->` })
  assert.equal(pendingClose([harness(b)]), null)
  assert.equal(postmortemState([harness(b)]), 'done')
})
test('renderSkipped is a trusted skipped marker with the run link and no mention', () => {
  const s = renderSkipped({ epic: 7, runUrl: 'https://x/run/1' })
  assert.equal(postmortemState([harness(s)]), 'skipped')
  assert.match(s, /https:\/\/x\/run\/1/)
  assert.doesNotMatch(s, /@\w/)
})
test('the prompt points at the skill, the out file, and forbids writes', () => {
  const p = buildPostmortemPrompt({ epic: 7, outFile: '/tmp/pm.md' })
  assert.match(p, /\.claude\/skills\/postmortem\/SKILL\.md/)
  assert.match(p, /\/tmp\/pm\.md/)
  assert.match(p, /Do NOT post comments/)
  assert.match(p, /🔭 Next/)
})
