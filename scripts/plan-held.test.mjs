import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentOverrideDecision, isPlanHeld, overrideReason } from './plan-held.mjs'

const bot = (body) => ({ body, userType: 'Bot' })
const plan = bot('<!-- pipeline-plan:v1 --> plan')
const hold = bot('<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n<!-- plan-review-held -->\n🔴 **Plan rejected twice** — held')
const reject1 = bot('<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n🔴 Plan rejected — sent back')

test('held: the newest event is the twice-rejected verdict', () => {
  assert.equal(isPlanHeld([plan, reject1, plan, hold]), true)
})
test('not held: a first rejection only sends the plan back', () => {
  assert.equal(isPlanHeld([plan, reject1]), false)
})
test('not held: a newer plan after the hold cancels it', () => {
  assert.equal(isPlanHeld([plan, hold, plan]), false)
})
test('not held: a person pasting the markers is ignored', () => {
  assert.equal(isPlanHeld([plan, { body: hold.body, userType: 'User' }]), false)
})
test('not held: no comments', () => {
  assert.equal(isPlanHeld([]), false)
})
test('held: wording changed but the marker is present', () => {
  assert.equal(isPlanHeld([plan, bot('<!-- plan-review:v1 -->\n<!-- plan-review-held -->\nsomething else')]), true)
})
test('not held: wording says rejected twice but there is no marker', () => {
  assert.equal(isPlanHeld([plan, bot('<!-- plan-review:v1 -->\n🔴 Plan rejected twice')]), false)
})

test('overrideReason: needs `ok:`/`lgtm:` opening the reply and a non-empty reason', () => {
  assert.equal(overrideReason('ok: the reviewer misread the schema'), 'the reviewer misread the schema')
  assert.equal(overrideReason('LGTM: scope is fine here'), 'scope is fine here')
  assert.equal(overrideReason('ok'), '')
  assert.equal(overrideReason('ok:   '), '')
  assert.equal(overrideReason('I said ok: the reviewer misread it'), '')
  assert.equal(overrideReason('> ok: the reviewer misread it'), '')
})

const by = (login, body) => ({ body, user: { login } })
const decision = by('nuxt-harness[bot]', '**Decision (owner override, 2026-10-29):** build it anyway')
const planC = by('nuxt-harness[bot]', '<!-- pipeline-plan:v1 --> plan')

test('currentOverrideDecision: the bot decision after the newest plan is picked up', () => {
  assert.equal(currentOverrideDecision([planC, decision]), decision.body)
})
test('currentOverrideDecision: the same text from another author is ignored', () => {
  assert.equal(currentOverrideDecision([planC, by('someone', decision.body)]), '')
})
test('currentOverrideDecision: a decision older than the newest plan is ignored', () => {
  assert.equal(currentOverrideDecision([planC, decision, planC]), '')
})
