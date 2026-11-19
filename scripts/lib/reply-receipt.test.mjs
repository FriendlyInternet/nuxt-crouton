// node --test scripts/lib/reply-receipt.test.mjs — the reply receipt (#4207).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { receiptLine, applyReceipt, brusselsTime } from './reply-receipt.mjs'
import { openRecord } from './reply-record.mjs'
import { todayOutcome, meaningToday } from '../reply-replay.mjs'
import { isPlanHold, needsOwnerQuestion } from '../plan-hold.mjs'
import { findApprovedPlan } from '../plan-checks.mjs'
import { ownerQuestionKind } from './signoff-route.mjs'
import { BOT } from '../plan-held.mjs'

const URL_ = 'https://github.com/o/r/issues/1#issuecomment-9'
const AT = '2026-11-19T09:28:00Z'
const line = (d) => receiptLine({ replyUrl: URL_, date: AT, ...d })
const wrap = (text) => `↩️ [Your reply](${URL_}) (19 Nov 10:28, Europe/Brussels) was ${text}.`

// covers: T1
test('T1 receiptLine: every starts/kind in the ticket table, in fixed plain words', () => {
  const table = [
    [{ kind: 'resume', starts: 'replan-with-yes' }, 'read as **yes** → re-planning with your yes'],
    [{ kind: 'resume', starts: 'replan-with-feedback' }, 'read as **a comment** → passed to the planner'],
    [{ kind: 'resume', starts: 'answer-worker' }, 'read as **your answer** → passed to the worker'],
    [{ kind: 'approve-plan' }, 'read as **ok with a reason** → plan approved, building'],
    [{ kind: 'plan-needs-reason' }, 'read as **ok without a reason** → asked you for the reason'],
    [{ kind: 'resume' }, 'read as **a reply** → the paused work picks it up'],
    [{ kind: 'resume', starts: '' }, 'read as **a reply** → the paused work picks it up'],
    [{ kind: 'interpret' }, 'read as **a comment**, not an answer'],
    [{ kind: 'dispatch' }, '**not an answer** — handled as a command'],
    [{ kind: 'close-epic' }, '**not an answer** — handled as a command'],
    [{ kind: 'fresh-branch' }, '**not an answer** — handled as a command'],
    [{ kind: 'quiz-reply' }, '**not an answer** — handled as a quiz / test-card reply'],
    [{ kind: 'test-card' }, '**not an answer** — handled as a quiz / test-card reply'],
    [{ kind: 'none', reason: 'not the owner' }, '**not read as an answer** — not the owner'],
    [{ kind: 'none', reason: 'two\nlines <!-- x -->' }, '**not read as an answer** — two lines x'],
    [{ kind: 'none' }, '**not read as an answer**'],
    [{ kind: 'revise' }, '**not read as an answer**'],
    [{ kind: 'approve-draft' }, '**not read as an answer**'],
    [{ kind: 'automerge-go' }, '**not read as an answer**'],
    [{ kind: 'something-new', reason: 'hidden' }, '**not read as an answer**'],
    [{}, '**not read as an answer**'],
  ]
  for (const [d, text] of table) assert.equal(line(d), wrap(text), JSON.stringify(d))
})

// covers: T1
test('T1 the date is D Mon HH:MM in Brussels time, no comma', () => {
  assert.equal(brusselsTime('2026-11-19T09:28Z'), '19 Nov 10:28')
  assert.equal(brusselsTime('2026-07-01T22:05:00Z'), '2 Jul 00:05', 'summer time, past midnight')
  assert.equal(brusselsTime('2026-03-05T08:00:00Z'), '5 Mar 09:00')
})

const MARKERS = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:needs-owner -->\n<!-- reply-record:v1 {"kind":"plan-question"} -->'
const BODY = `${MARKERS}\n> 🤖 review\n\n🔀 **Needs your call** — A?\n**Needs:** answer\n`

// covers: T2
test('T2 applyReceipt: no receipt ⇒ appended at the end, the rest byte for byte', () => {
  const out = applyReceipt(BODY, 'L1', AT)
  assert.equal(out, `${BODY}\n\n<!-- reply-receipt at=2026-11-19T09:28:00.000Z -->\nL1\n<!-- /reply-receipt -->`)
  assert.ok(out.startsWith(BODY))
  assert.ok(out.startsWith(`${MARKERS}\n> 🤖`), 'the leading marker block is untouched')
})

// covers: T2
test('T2 applyReceipt: an older receipt is replaced in place (exactly one block); a same or newer one is left alone', () => {
  const first = applyReceipt(BODY, 'L1', AT)
  const second = applyReceipt(first, 'L2 $& $1', '2026-11-19T10:00:00Z')
  assert.equal(second, `${BODY}\n\n<!-- reply-receipt at=2026-11-19T10:00:00.000Z -->\nL2 $& $1\n<!-- /reply-receipt -->`)
  assert.equal(second.match(/<!-- reply-receipt /g).length, 1)
  assert.equal(applyReceipt(second, 'stale', AT), second, 'an older reply never puts a stale line back')
  assert.equal(applyReceipt(second, 'same', '2026-11-19T10:00:00Z'), second)
  // text after the block (should someone edit below it) is kept
  const tail = `${first}\n\nedited later`
  assert.equal(applyReceipt(tail, 'L3', '2026-11-20T00:00:00Z'), `${BODY}\n\n<!-- reply-receipt at=2026-11-20T00:00:00.000Z -->\nL3\n<!-- /reply-receipt -->\n\nedited later`)
})

// ── T3 the rule: a receipt never changes how any reply or question is read ─────────────────
const dir = new URL('../fixtures/reply-replay/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
const isBot = (c) => c?.userType === 'Bot'
const withReceipts = (c) => ({
  ...c,
  comments: c.comments.map((x) => (isBot(x) ? { ...x, body: applyReceipt(x.body, line({ kind: 'resume', starts: 'replan-with-yes' }), AT) } : x)),
})
/** findApprovedPlan reads the REST `user.login`; the fixtures carry `userType` only. */
const asRest = (comments) => comments.map((x) => ({ ...x, user: { login: isBot(x) ? BOT : 'pmcp', type: x.userType } }))
const readings = (c) => ({
  today: meaningToday(todayOutcome(c)),
  outcome: todayOutcome(c),
  record: openRecord({ comments: c.comments, labels: c.labels }),
  planHold: isPlanHold({ comments: c.comments, labels: c.labels, replyBody: c.reply.body }),
  question: needsOwnerQuestion(c.comments),
  approved: findApprovedPlan(asRest(c.comments))?.body ?? null,
  kinds: c.comments.map((x) => ownerQuestionKind(x.body)),
})

// covers: T3
test('T3 a receipt on every question comment changes no reading of any replay case', () => {
  assert.ok(files.length >= 5)
  let questions = 0
  for (const file of files) {
    const c = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
    const r = withReceipts(c)
    questions += c.comments.filter(isBot).length
    const before = readings(c)
    const after = readings(r)
    assert.deepEqual({ ...after, approved: after.approved && after.approved.replace(/\n\n<!-- reply-receipt [\s\S]*$/, '') }, before, file)
  }
  assert.ok(questions > 0, 'the receipt was really applied to some question')
})
