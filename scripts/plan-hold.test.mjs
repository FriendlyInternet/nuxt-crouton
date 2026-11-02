import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { isPlanHold, resumeOutcome } from './plan-hold.mjs'

const bot = (body) => ({ body, userType: 'Bot' })
const person = (body) => ({ body, userType: 'User' })
const NOGO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n🔴 **Plan rejected twice**'
const GO = '<!-- plan-review-verdict:go -->'
const PLAN = '<!-- pipeline-plan:v1 -->\nplan'
const BLOCKED = ['status:blocked']
const hold = (comments, extra = {}) => isPlanHold({ comments, labels: BLOCKED, replyBody: 'Use the existing helper.', ...extra })

const heldThread = () => [bot(PLAN), bot(NOGO), bot(PLAN), bot(NOGO), person('Use the existing helper instead.')]

// Real threads of #3057/#3058/#3061/#3131/#3132/#3138/#3139/#3140 (bodies trimmed). Several were
// resolved later, so replay each up to its last no-go before any `go`: the moment it was held.
const dir = new URL('./fixtures/plan-hold/', import.meta.url)
const VERDICT = /plan-review-verdict:(go|no-go|needs-owner)/
function heldPrefix(comments) {
  let last = -1
  for (let i = 0; i < comments.length; i++) {
    const m = VERDICT.exec(comments[i].body)
    if (m?.[1] === 'go') break
    if (m?.[1] === 'no-go') last = i
  }
  return comments.slice(0, last + 1)
}

test('replayed real held threads each re-plan, never "still iterating"', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  assert.equal(files.length, 8)
  for (const f of files) {
    const fx = JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
    const comments = heldPrefix(fx.comments)
    assert.equal(isPlanHold({ comments, labels: fx.labels, replyBody: 'Use the existing helper.' }), true, `#${fx.issue}`)
    assert.equal(resumeOutcome({ planHold: true, dispatched: true, newComment: true }), 'replan', `#${fx.issue}`)
  }
})

test('two no-go reviews, newest a no-go, status:blocked ⇒ plan hold', () => {
  assert.equal(hold(heldThread()), true)
})

test('without status:blocked it is not a hold (block dropped)', () => {
  assert.equal(isPlanHold({ comments: heldThread(), labels: [], replyBody: 'x' }), false)
})

test('plan:approved ⇒ not a hold (late reply, #3057 shape)', () => {
  assert.equal(hold(heldThread(), { labels: ['status:blocked', 'plan:approved'] }), false)
})

test('an `ok` approval is not feedback to re-plan from', () => {
  assert.equal(hold(heldThread(), { replyBody: 'ok' }), false)
  assert.equal(hold(heldThread(), { replyBody: 'lgtm' }), false)
})

test('a single no-go (round 1 re-plans by itself) is not a hold', () => {
  assert.equal(hold([bot(PLAN), bot(NOGO)]), false)
})

test('a later go verdict ends the hold', () => {
  assert.equal(hold([...heldThread(), bot(PLAN), bot(GO)]), false)
})

test('a person pasting the marker does not make a hold', () => {
  assert.equal(hold([person(NOGO), person(NOGO)]), false)
})

test('design-hold / gate-PR threads without verdicts are not plan holds', () => {
  assert.equal(hold([bot('🎨 Design sign-off needed before building')]), false)
  assert.equal(hold([]), false)
  assert.equal(isPlanHold(), false)
})

test('plan hold, nothing dispatched, nothing posted ⇒ nothing (the 🔴 outcome)', () => {
  assert.equal(resumeOutcome({ planHold: true, dispatched: false, newComment: false }), 'nothing')
})

test('not a plan hold ⇒ existing behaviour', () => {
  assert.equal(resumeOutcome({ planHold: false, dispatched: false, newComment: false }), 'ok')
})

test('on-comment.yml wires the helper: replan step, agent skip, gate outcome', () => {
  const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
  assert.match(wf, /id: replan/)
  assert.match(wf, /steps\.replan\.outputs\.replan != 'true'/)
  assert.match(wf, /resumeOutcome\(/)
  assert.match(wf, /replyBody: context\.payload\.comment\.body/)
})
