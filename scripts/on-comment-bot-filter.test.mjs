import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { OWNER_SCREENS, OWNER_SCREEN_APPS } from './lib/owner-screens.mjs'

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
  // evalIf (below) adds the optional chaining + contains() the #3691 owner-screen clause needs.
  const runs = (comment) => evalIf('rl-start', { comment, issue: { number: 1, labels: [] } })
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
    .replace(/\.labels\.\*\.name/g, '.labels.map(l => l.name)')
    .replace(/performed_via_github_app\./g, 'performed_via_github_app?.')
  const startsWith = (s, p) => String(s ?? '').startsWith(p)
  const contains = (a, v) => (Array.isArray(a) ? a.includes(v) : String(a ?? '').includes(v))
  return !!new Function('github', 'startsWith', 'contains', `return !!(${expr})`)({ event }, startsWith, contains)
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
  const workflows = readdirSync(new URL('../.github/workflows/', import.meta.url))
  assert.equal(workflows.includes('plan-review.yml'), false)
})

// #3691 — owner-screen comments: the one bot comment route/rl-start let through.
const screen = (body, { slug = 'nuxt-harness', labels = ['status:blocked'] } = {}) => ({
  issue: { number: 1, labels: labels.map(name => ({ name })) },
  comment: { body, user: { login: `${slug}[bot]`, type: 'Bot' }, performed_via_github_app: { name: 'Nuxt Harness', slug } },
})

test('owner screen: 📐/🎯 from nuxt-harness on a blocked item starts route and rl-start; nothing else does', () => {
  for (const job of ['route', 'rl-start']) {
    assert.equal(evalIf(job, screen('📐 Diagram saved — continuing from your edit')), true, job)
    assert.equal(evalIf(job, screen('🎯 **Preview feedback**')), true, job)
    assert.equal(evalIf(job, screen('📐 Diagram saved', { labels: [] })), false, job)
    assert.equal(evalIf(job, screen('> 🤖 **pi.dev harness** · x')), false, job)
    assert.equal(evalIf(job, screen('> 📐 Diagram saved')), false, job)
    assert.equal(evalIf(job, screen('📐 Diagram saved', { slug: 'github-actions' })), false, job)
    // people still route as before
    assert.equal(evalIf(job, { issue: { number: 1, labels: [] }, comment: { body: 'hi', user: { type: 'User' }, performed_via_github_app: null } }), true, job)
  }
})

test('owner screen: the if: emoji set and app slug match scripts/lib/owner-screens.mjs (drift guard)', () => {
  const expr = jobIf('route')
  const emoji = [...expr.matchAll(/startsWith\(github\.event\.comment\.body, '([^']+)'\)/g)].map(m => m[1])
  assert.deepEqual(emoji, OWNER_SCREENS.map(s => s.emoji))
  const slugs = [...expr.matchAll(/performed_via_github_app\.slug == '([^']+)'/g)].map(m => m[1])
  assert.deepEqual(slugs, OWNER_SCREEN_APPS)
})

test('owner screen: the plan-mode "who wrote this" line in work-issue-pidev.yml asks the module', () => {
  const pi = readFileSync(new URL('../.github/workflows/work-issue-pidev.yml', import.meta.url), 'utf8')
  const line = pi.split('\n').find(l => l.includes('--jq .user.type)" != "Bot" ]'))
  assert.ok(line, 'plan-mode Bot check not found')
  assert.match(line, /\|\| node scripts\/lib\/owner-screens\.mjs --is-source "\$RUNNER_TEMP\/feedback\.txt"/)
})

test('record-outcome still tolerates a skipped rl-start', () => {
  const b = jobBlock('record-outcome')
  assert.match(b, /needs: \[rl-start,/)
  assert.match(b, /\n    if: \$\{\{ always\(\)/)
})
