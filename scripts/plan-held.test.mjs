import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { currentOverrideDecision, overrideComment, BOT } from './plan-held.mjs'

const plan = (login = BOT) => ({ body: '<!-- pipeline-plan:v1 -->\nplan', user: { login } })
const dec = (login, reason = 'cosmetic') => ({ body: overrideComment({ reason, date: '2026-11-10', url: 'u' }), user: { login } })

test('bot decision after the newest plan is returned', () => {
  assert.equal(currentOverrideDecision([plan(), dec(BOT)]), 'cosmetic')
})
test('the same text from a person or another bot is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), dec('pmcp')]), '')
  assert.equal(currentOverrideDecision([plan(), dec('github-actions[bot]')]), '')
})
test('a decision before a newer plan is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), dec(BOT), plan()]), '')
})
test('a lookalike "Decision (owner override" comment from someone else is ignored', () => {
  assert.equal(currentOverrideDecision([plan(), { body: 'Decision (owner override): sneaky', user: { login: 'eve' } }]), '')
})
test('no comments → empty', () => assert.equal(currentOverrideDecision(), ''))

// Real entry points: the workflows must wire the rule, not just the helper exist.
const onComment = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')
const build = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
test('on-comment.yml has a job per new router choice and passes planHeld', () => {
  assert.match(onComment, /needs\.route\.outputs\.kind == 'approve-plan'/)
  assert.match(onComment, /needs\.route\.outputs\.kind == 'plan-needs-reason'/)
  assert.match(onComment, /planHeld/)
})
test('the build prompt reads the override only through plan-held.mjs', () => {
  assert.match(build, /plan-held\.mjs --decision/)
})
