import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const wf = readFileSync(new URL('../.github/workflows/on-comment.yml', import.meta.url), 'utf8')

const jobBlock = (name) => {
  const m = wf.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`))
  assert.ok(m, `job ${name} not found`)
  return m[1]
}
const jobIf = (name) => {
  const m = jobBlock(name).match(/\n    if: >-\n((?:      .*\n?)+)/)
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

test('rl-start has the same job-level if as route', () => {
  const a = jobIf('rl-start')
  assert.notEqual(a, '')
  assert.equal(a, jobIf('route'))
})

test('the shared filter skips bots and runs for people', () => {
  const expr = jobIf('rl-start').replace(/==/g, '===').replace(/!=/g, '!==')
  const runs = (comment) => new Function('github', `return !!(${expr})`)({ event: { comment } })
  const f = (c) => runs({ ...c, performed_via_github_app: c.performed_via_github_app ?? null })
  assert.equal(f({ user: { type: 'Bot' } }), false)
  assert.equal(f({ user: { type: 'User' }, performed_via_github_app: { name: 'Harness' } }), false)
  assert.equal(f({ user: { type: 'User' } }), true)
  assert.equal(f({ user: { type: 'User' }, performed_via_github_app: { name: 'Claude' } }), true)
})

// #3313 — plan review lives here now, as an unrouted job with its own filter. Evaluate the real
// job-level `if:` expressions on comment events shaped like GitHub's payload.
const evalIf = (name, event) => {
  const expr = jobIf(name).replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').replace(/==/g, '===').replace(/!=/g, '!==')
  const startsWith = (s, p) => String(s ?? '').startsWith(p)
  return !!new Function('github', 'startsWith', `return !!(${expr})`)({ event }, startsWith)
}
const PLAN = '<!-- pipeline-plan:v1 -->\n## Plan'
const ev = (login, type, body, pr = false) => ({
  issue: { number: 1, ...(pr ? { pull_request: { url: 'x' } } : {}) },
  comment: { body, user: { login, type }, performed_via_github_app: type === 'Bot' ? { name: 'nuxt-harness' } : null },
})

test('plan-review: the harness bot\'s plan on an issue runs the review, and not route/rl-start', () => {
  const e = ev('nuxt-harness[bot]', 'Bot', PLAN)
  assert.equal(evalIf('plan-review', e), true)
  assert.equal(evalIf('route', e), false)
  assert.equal(evalIf('rl-start', e), false)
})

test('plan-review: a person pasting the marker, a PR, or another bot does not start a review', () => {
  assert.equal(evalIf('plan-review', ev('pmcp', 'User', PLAN)), false)
  assert.equal(evalIf('plan-review', ev('nuxt-harness[bot]', 'Bot', PLAN, true)), false)
  assert.equal(evalIf('plan-review', ev('github-actions[bot]', 'Bot', PLAN)), false)
  assert.equal(evalIf('plan-review', ev('nuxt-harness[bot]', 'Bot', `hi\n${PLAN}`)), false)
})

test('plan-review: an owner reply routes as before and starts no review', () => {
  const e = ev('pmcp', 'User', 'ok')
  assert.equal(evalIf('route', e), true)
  assert.equal(evalIf('plan-review', e), false)
})

test('plan-review: one review per issue at a time; plan-review.yml is gone (one listener)', () => {
  assert.match(jobBlock('plan-review'), /\n    concurrency:\n      group: plan-review-\$\{\{ github\.event\.issue\.number \}\}\n      cancel-in-progress: false\n/)
  assert.equal(existsSync(new URL('../.github/workflows/plan-review.yml', import.meta.url)), false)
})

test('record-outcome still tolerates a skipped rl-start', () => {
  const b = jobBlock('record-outcome')
  assert.match(b, /needs: \[rl-start,/)
  assert.match(b, /\n    if: \$\{\{ always\(\)/)
})
