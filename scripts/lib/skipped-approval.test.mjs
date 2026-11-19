// #4038 T2 — an approval that starts nothing always gets an answer. node --test scripts/lib/skipped-approval.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { skippedApprovalNote, runSkippedApproval, NOTICE } from './skipped-approval.mjs'

test('epic with a wait reason, no PR → the note names the reason (case 4)', () => {
  const b = skippedApprovalNote({ isEpic: true, labels: ['epic'], epicWaiting: ['test card answered not ok — fix sub-issue'] })
  assert.match(b, /this epic waits on/)
  assert.match(b, /- test card answered not ok — fix sub-issue/)
  assert.ok(b.startsWith('<!-- pipeline-note -->\n' + NOTICE + '\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _approval reply on a non-blocked issue_'))
})

test('epic with nothing waiting → "nothing on this issue waits for a reply" (case 3)', () => {
  assert.match(skippedApprovalNote({ isEpic: true, labels: ['epic'], epicWaiting: [] }), /nothing on this issue waits for a reply/)
})

test('open PR into epic/x without status:blocked → the #1665 text naming the PR', () => {
  const b = skippedApprovalNote({ labels: [], openPrs: [{ number: 77, base: { ref: 'epic/x' } }] })
  assert.match(b, /PR #77/)
  assert.match(b, /still open into `epic\/x`/)
  assert.match(b, /Add `status:blocked` back and reply again/)
  assert.match(b, /#1665/)
})

test('plain issue with an open PR into main → lists it, says a reply here starts nothing', () => {
  const b = skippedApprovalNote({ openPrs: [{ number: 12, base: { ref: 'main' } }] })
  assert.match(b, /- #12 into `main`/)
  assert.match(b, /`status:blocked` is not on this issue/)
})

test('plain issue with nothing open → nothing waits', () => {
  assert.match(skippedApprovalNote({}), /nothing on this issue waits for a reply/)
})

test('marker in the last 3 comments → null; 4 comments back → a note', () => {
  const c = (body) => ({ body })
  assert.equal(skippedApprovalNote({ recentComments: [c('a'), c(NOTICE), c('b'), c('c')] }), null)
  assert.ok(skippedApprovalNote({ recentComments: [c(NOTICE), c('a'), c('b'), c('c')] }))
})

test('runSkippedApproval on a plain issue with no PRs posts exactly one note (run 43957677096 used to stay silent)', async () => {
  const posted = []
  const github = {
    rest: {
      issues: {
        listEventsForTimeline: 'timeline', listComments: 'comments',
        get: async () => ({ data: { labels: [{ name: 'type:fix' }] } }),
        createComment: async (a) => { posted.push(a) },
      },
      pulls: { get: async () => { throw new Error('no PRs expected') } },
    },
    paginate: async (fn) => (fn === 'timeline' || fn === 'comments' ? [] : Promise.reject(new Error(fn))),
  }
  const context = { repo: { owner: 'o', repo: 'r' }, payload: { issue: { number: 5 } } }
  await runSkippedApproval({ github, context, core: { info() {}, warning() {} } })
  assert.equal(posted.length, 1)
  assert.match(posted[0].body, /nothing on this issue waits for a reply/)
})
