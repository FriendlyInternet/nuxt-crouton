import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentOverrideDecision } from './plan-held.mjs'

const bot = 'nuxt-harness[bot]'
const m = (login, body) => ({ user: { login }, body })
const plan = m(bot, '<!-- pipeline-plan:v1 -->\nplan')
const dec = '**Decision (owner override, 2026-11-03):** cosmetic'

test('bot decision after the newest plan is returned', () => {
  assert.equal(currentOverrideDecision([plan, m(bot, dec)]), dec)
})
test('same text by a person or another bot is ignored', () => {
  assert.equal(currentOverrideDecision([plan, m('pmcp', dec), m('other[bot]', dec)]), '')
})
test('a decision before a newer plan is stale', () => {
  assert.equal(currentOverrideDecision([plan, m(bot, dec), plan]), '')
})
test('lookalike text is ignored', () => {
  assert.equal(currentOverrideDecision([plan, m(bot, 'see **Decision (owner override** above')]), '')
  assert.equal(currentOverrideDecision(undefined), '')
})
