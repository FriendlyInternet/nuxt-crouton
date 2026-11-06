import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsReview, sweepScope, sweepAll, FULL_SWEEP_MS } from './build-review-sweep.mjs'
import { isRateLimitError } from './lib/rate-limit.mjs'

const now = Date.parse('2026-11-02T12:00:00Z')
const pr = (o = {}) => ({ headRefName: 'work-1', baseRefName: 'main', headRefOid: 'X', state: 'OPEN', isDraft: false, author: { login: 'app/nuxt-harness' }, ...o })
const gate = (o = {}) => [{ name: 'CI Gate', status: 'completed', conclusion: 'success', started_at: '2026-11-02T11:00:00Z', completed_at: '2026-11-02T11:30:00Z', ...o }]
const run = (o = {}) => needsReview({ pr: pr(), checks: gate(), comments: [], headCommitDate: '2026-11-02T10:00:00Z', now, ...o })

test('(a) green, old, no markers → needs review (main and epic)', () => {
  assert.equal(run(), true)
  assert.equal(run({ pr: pr({ baseRefName: 'epic/1-x' }) }), true)
})
test('(b) review marker present → no', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-sha:X -->', created_at: '2026-11-02T11:40:00Z' }] }), false)
})
test('(c) younger than 15 min → no', () => {
  assert.equal(run({ checks: gate({ completed_at: '2026-11-02T11:50:00Z' }) }), false)
})
test('(d) CI Gate not success → no', () => {
  assert.equal(run({ checks: gate({ conclusion: 'failure' }) }), false)
  assert.equal(run({ checks: [] }), false)
})
test('(e) sweep already dispatched for this SHA → no', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-sweep:X -->', created_at: '2026-11-02T11:45:00Z' }] }), false)
})
test('(f) failed review on this SHA is not re-dispatched', () => {
  assert.equal(run({ comments: [{ body: '<!-- build-review-failed -->', created_at: '2026-11-02T11:00:00Z' }] }), false)
  assert.equal(run({ comments: [{ body: '<!-- build-review-failed -->\n<!-- build-review-failed-sha:X -->', created_at: '2026-11-02T09:00:00Z' }] }), false)
})
test('(g) push after a failure re-arms', () => {
  assert.equal(run({ pr: pr({ headRefOid: 'Y' }), comments: [{ body: '<!-- build-review-failed -->\n<!-- build-review-failed-sha:X -->', created_at: '2026-11-02T09:00:00Z' }] }), true)
  assert.equal(run({ headCommitDate: '2026-11-02T11:20:00Z', comments: [{ body: '<!-- build-review-failed -->', created_at: '2026-11-02T11:00:00Z' }] }), true)
})
test('(h) draft or non-bot → no', () => {
  assert.equal(run({ pr: pr({ isDraft: true }) }), false)
  assert.equal(run({ pr: pr({ author: { login: 'pmcp' } }) }), false)
})

test('(bootstrap) workflow sweep step completes with a warning when the import fails', async () => {
  const { readFileSync } = await import('node:fs')
  const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  const i = wf.indexOf('const { owner, repo } = context.repo\n            // Bootstrap-safe')
  assert.ok(i > -1, 'sweep step with bootstrap-safe import not found')
  const lines = wf.slice(i).split('\n')
  const body = [lines.shift()]
  for (const l of lines) { if (l.startsWith('            ')) body.push(l.slice(12)); else break }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const warnings = []
  const prev = process.env.GITHUB_WORKSPACE
  process.env.GITHUB_WORKSPACE = '/nonexistent-workspace'
  try {
    const fn = new AsyncFunction('context', 'github', 'core', body.join('\n'))
    const github = new Proxy({}, { get() { throw new Error('github must not be touched when the import fails') } })
    await fn({ repo: { owner: 'o', repo: 'r' } }, github, { warning: m => warnings.push(m), info() {} })
  } finally { process.env.GITHUB_WORKSPACE = prev }
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /sweep skipped/)
})

// ---- sweepScope / sweepAll (#3385) ----
const MIN = 60 * 1000
const fresh = new Date(now - 10 * MIN).toISOString()
const scope = (o) => sweepScope({ lastFullSweepAt: fresh, now, ...o })

test('sweepScope: schedule and bare dispatch → all', () => {
  assert.deepEqual(scope({ eventName: 'schedule' }), { all: true, prs: [] })
  assert.equal(scope({ eventName: 'workflow_dispatch', inputsPr: '' }).all, true)
  assert.equal(scope({ eventName: 'workflow_dispatch', inputsPr: undefined }).all, true)
})
test('sweepScope: dispatch with pr → [pr], falls back when candidates empty', () => {
  assert.deepEqual(scope({ eventName: 'workflow_dispatch', inputsPr: '42', candidates: '[42]' }), { all: false, prs: [42] })
  assert.deepEqual(scope({ eventName: 'workflow_dispatch', inputsPr: '42', candidates: '' }), { all: false, prs: [42] })
})
test('sweepScope: event candidates', () => {
  assert.deepEqual(scope({ eventName: 'workflow_run', candidates: '[12]' }), { all: false, prs: [12] })
  for (const c of ['', '[]', undefined, 'not json']) assert.deepEqual(scope({ eventName: 'workflow_run', candidates: c }), { all: false, prs: [] })
  assert.deepEqual(scope({ eventName: 'pull_request', candidates: [12, 12, '13'] }), { all: false, prs: [12, 13] })
  assert.deepEqual(scope({ eventName: 'issue_comment', candidates: '[5]' }), { all: false, prs: [5] })
})
test('sweepScope: stale or unknown last full sweep → all', () => {
  const at = (m) => new Date(now - m * MIN).toISOString()
  const ev = { eventName: 'workflow_run', candidates: '[12]' }
  assert.deepEqual(sweepScope({ ...ev, lastFullSweepAt: at(59), now }), { all: false, prs: [12] })
  assert.equal(sweepScope({ ...ev, lastFullSweepAt: at(61), now }).all, true)
  for (const v of [undefined, '', 'garbage']) assert.equal(sweepScope({ ...ev, lastFullSweepAt: v, now }).all, true)
  assert.equal(FULL_SWEEP_MS, 60 * MIN)
})

test('(rule) after >60 min with no full sweep, one unrelated event sweeps all PRs and dispatches the stranded green PR', () => {
  const T = now
  const at = (m) => new Date(T + m * MIN).toISOString()
  const p = pr({ headRefName: 'work-3210', headRefOid: 'abc' })
  const checks = gate({ completed_at: at(0), started_at: at(-5) })
  const due = (n, comments = []) => needsReview({ pr: p, checks, comments, headCommitDate: at(-30), now: n })
  const last = at(-5)
  assert.deepEqual(sweepScope({ eventName: 'workflow_run', candidates: '[3212]', lastFullSweepAt: last, now: T }), { all: false, prs: [3212] })
  assert.equal(due(T), false)
  assert.deepEqual(sweepScope({ eventName: 'workflow_run', candidates: '[3384]', lastFullSweepAt: last, now: T + 20 * MIN }), { all: false, prs: [3384] })
  assert.equal(sweepScope({ eventName: 'workflow_run', candidates: '[3384]', lastFullSweepAt: last, now: T + 70 * MIN }).all, true)
  assert.equal(due(T + 70 * MIN), true)
  const marker = [{ body: '<!-- build-review-sweep:abc -->', created_at: at(70) }]
  assert.deepEqual(sweepScope({ eventName: 'workflow_run', candidates: '[3384]', lastFullSweepAt: at(70), now: T + 80 * MIN }), { all: false, prs: [3384] })
  assert.equal(due(T + 80 * MIN, marker), false)
})

test('sweepAll: stamps only when every PR was read', async () => {
  const t = new Date(now)
  const prs = [1, 2, 3, 4].map((number) => ({ number }))
  assert.deepEqual(await sweepAll(prs, async () => {}, { now: () => t }), { checked: 4, failed: 0, stampAt: t.toISOString() })
  const warns = []
  const seen = []
  const r = await sweepAll(prs, async (p) => { seen.push(p.number); if (p.number === 2) throw new Error('boom') }, { now: () => t, warn: (m) => warns.push(m) })
  assert.deepEqual(r, { checked: 4, failed: 1, stampAt: null })
  assert.deepEqual(seen, [1, 2, 3, 4])
  assert.match(warns[0], /^build-review sweep #2: boom/)
  assert.equal((await sweepAll([], async () => {}, { now: () => t })).stampAt, t.toISOString())
})

test('(rule) a rate limit halfway through the full sweep writes no time, so the next event sweeps all PRs again', async () => {
  const T = now
  const t = new Date(T)
  const stale = new Date(T - 75 * MIN).toISOString()
  const prs = [1, 2, 3, 4, 5, 6].map((number) => ({ number }))
  const limit = () => Object.assign(new Error('API rate limit exceeded for installation'), { status: 403, response: { headers: { 'x-ratelimit-remaining': '0' } } })
  const warned = []
  assert.equal(sweepScope({ eventName: 'workflow_run', candidates: '[1]', lastFullSweepAt: stale, now: T }).all, true)
  const r = await sweepAll(prs, async (p) => { if (p.number >= 4) throw limit() }, { now: () => t, warn: (m) => warned.push(m) })
  assert.deepEqual(r, { checked: 6, failed: 3, stampAt: null })
  assert.equal(warned.length, 3)
  assert.equal(isRateLimitError(limit()), true)
  assert.equal(sweepScope({ eventName: 'workflow_run', candidates: '[2]', lastFullSweepAt: stale, now: T + 5 * MIN }).all, true)
  const ok = await sweepAll(prs, async () => {}, { now: () => t })
  assert.equal(ok.stampAt, t.toISOString())
  assert.deepEqual(sweepScope({ eventName: 'workflow_run', candidates: '[2]', lastFullSweepAt: ok.stampAt, now: T + 5 * MIN }), { all: false, prs: [2] })
})
