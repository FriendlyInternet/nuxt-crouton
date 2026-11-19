/**
 * #3195 — CI runs the approved plan's Test checklist (plan-checks.mjs) and the ci.yml wiring.
 * #4037 — any Run: line gets the dependency install (needsInstall), not only pnpm/npx/vitest/nuxi/tsc.
 *   node --test scripts/plan-checks.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOT, STICKY, findApprovedPlan, decidePlan, runChecks, execCommand, renderComment, exitCode, main, upsertSticky } from './plan-checks.mjs'

const fixture = readFileSync(new URL('./fixtures/plan-review/clean.plan.md', import.meta.url), 'utf8')
const planWith = (lines) => fixture.replace(/### Test\n[\s\S]*?\n(?=### )/, `### Test\n${lines.join('\n')}\n`)
const PLAN = planWith([
  '- [ ] T1 — passes — Run: `true`',
  '- [ ] T2 — fails — Run: `echo boom; false`',
  '- [ ] T3 — a person looks — Manual: no device in CI',
])
const GO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:go -->\n✅ Plan approved'
const NOGO = '<!-- plan-review:v1 -->\n<!-- plan-review-verdict:no-go -->\n❌'
const c = (id, body, login = BOT) => ({ id, body, user: { login }, html_url: `https://x/c${id}` })

const quiet = () => {}

async function pipeline({ comments, headRef = 'work-3195', exec }) {
  const d = mkdtempSync(join(tmpdir(), 'plan-checks-'))
  const env = { HEAD_REF: headRef, PR_NUMBER: '', HEAD_SHA: 'abcdef1234', GITHUB_REPOSITORY: 'o/r' }
  await main(['fetch', '--out', join(d, 'plan.json')], { env, comments, log: quiet })
  await main(['run', '--plan', join(d, 'plan.json'), '--out', join(d, 'results.json'), '--cwd', d], { env, exec, log: quiet })
  const code = await main(['report', '--plan', join(d, 'plan.json'), '--results', join(d, 'results.json')], { env, log: quiet })
  return { code, plan: JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8')), results: JSON.parse(readFileSync(join(d, 'results.json'), 'utf8')) }
}

test('non-zero exit → ❌ and the job fails; Manual: → 🖐 and not run', async () => {
  const ran = []
  const exec = async (cmd) => { ran.push(cmd); return execCommand(cmd) }
  const r = await pipeline({ comments: [c(1, PLAN), c(2, GO)], exec })
  assert.equal(r.code, 1)
  assert.deepEqual(ran, ['true', 'echo boom; false'])
  assert.deepEqual(r.results.map((x) => [x.id, x.status, x.exit]), [['T1', 'pass', 0], ['T2', 'fail', 1], ['T3', 'manual', null]])
  assert.match(r.results[1].tail, /boom/)
})

async function fetchPlan(comments) {
  const d = mkdtempSync(join(tmpdir(), 'plan-checks-'))
  const env = { HEAD_REF: 'work-4037', PR_NUMBER: '', HEAD_SHA: 'abcdef1234', GITHUB_REPOSITORY: 'o/r' }
  await main(['fetch', '--out', join(d, 'plan.json')], { env, comments, log: quiet })
  return JSON.parse(readFileSync(join(d, 'plan.json'), 'utf8'))
}

// covers: T1
test('#4037: a deps-test Run line (node --test …) sets needsInstall true', async () => {
  const p = await fetchPlan([c(1, planWith(['- [ ] T1 — x — Run: `node --test scripts/gen-api-reference.deps-test.mjs`'])), c(2, GO)])
  assert.equal(p.items.length, 1)
  assert.equal(p.needsInstall, true)
})

// covers: T1
test('#4037: a plain node scripts/… Run line sets needsInstall true', async () => {
  const p = await fetchPlan([c(1, planWith(['- [ ] T1 — x — Run: `node scripts/component-names.mjs --check --fresh`'])), c(2, GO)])
  assert.equal(p.items.length, 1)
  assert.equal(p.needsInstall, true)
})

// covers: T2
test('#4037: a plan with only Manual lines sets needsInstall false', async () => {
  const p = await fetchPlan([c(1, planWith(['- [ ] T1 — x — Manual: no device in CI'])), c(2, GO)])
  assert.equal(p.items.length, 1)
  assert.equal(p.needsInstall, false)
})

test('every Run line passing → exit 0', async () => {
  const r = await pipeline({ comments: [c(1, planWith(['- [ ] T1 — ok — Run: `true`'])), c(2, GO)], exec: execCommand })
  assert.equal(r.code, 0)
})

test('timeout → ❌ with "timeout" in the tail (real process killed)', async () => {
  const started = Date.now()
  const [r] = await runChecks([{ id: 'T1', what: 'slow', type: 'run', detail: 'echo start; sleep 30' }], { timeoutMs: 300 })
  assert.ok(Date.now() - started < 10_000)
  assert.equal(r.status, 'fail')
  assert.equal(r.exit, 'timeout')
  assert.match(r.tail, /timeout/)
  assert.match(r.tail, /start/)
})

test('plan by a non-bot author is ignored (treated as no plan) and nothing runs', async () => {
  const ran = []
  const r = await pipeline({ comments: [c(1, PLAN, 'pmcp'), c(2, GO)], exec: async (cmd) => { ran.push(cmd); return { code: 1 } } })
  assert.equal(r.code, 0)
  assert.deepEqual(ran, [])
  assert.match(r.plan.summary, /no approved plan/)
})

test('a go verdict from a non-bot does not approve', () => {
  assert.equal(findApprovedPlan([c(1, PLAN), c(2, GO, 'pmcp')]), null)
})

test('no approved plan → exit 0 with a summary', async () => {
  for (const comments of [[], [c(1, PLAN)], [c(1, PLAN), c(2, NOGO)]]) {
    const r = await pipeline({ comments, exec: async () => { throw new Error('must not run') } })
    assert.equal(r.code, 0)
    assert.match(r.plan.summary, /no approved plan/)
  }
})

test('not a work-* PR → exit 0 with a summary', async () => {
  const r = await pipeline({ comments: [c(1, PLAN), c(2, GO)], headRef: 'feature/x', exec: async () => { throw new Error('must not run') } })
  assert.equal(r.code, 0)
  assert.match(r.plan.summary, /not a work-\* PR/)
})

test('newest approved plan wins; a newer unreviewed plan does not hide an approved one', () => {
  const p2 = planWith(['- [ ] T1 — second — Run: `true`'])
  assert.equal(findApprovedPlan([c(1, PLAN), c(2, GO), c(3, p2), c(4, GO)]).id, 3)
  assert.equal(findApprovedPlan([c(1, PLAN), c(2, GO), c(3, p2)]).id, 1)
  assert.equal(findApprovedPlan([c(1, PLAN), c(3, p2), c(4, GO)]).id, 3)
  assert.equal(decidePlan({ headRef: 'work-9', comments: [c(1, PLAN), c(2, GO)] }).items.length, 3)
})

test('a Run line with no recorded result is ❌, never a pass', async () => {
  const d = mkdtempSync(join(tmpdir(), 'plan-checks-'))
  const env = { HEAD_REF: 'work-1', GITHUB_REPOSITORY: 'o/r' }
  await main(['fetch', '--out', join(d, 'plan.json')], { env, comments: [c(1, PLAN), c(2, GO)], log: quiet })
  writeFileSync(join(d, 'results.json'), '[]')
  assert.equal(await main(['report', '--plan', join(d, 'plan.json'), '--results', join(d, 'results.json')], { env, log: quiet }), 1)
})

test('run step strips tokens from the commands\' environment', async () => {
  const d = mkdtempSync(join(tmpdir(), 'plan-checks-'))
  const env = { HEAD_REF: 'work-1', GH_TOKEN: 'secret', GITHUB_TOKEN: 'secret', PATH: process.env.PATH }
  await main(['fetch', '--out', join(d, 'plan.json')], { env, comments: [c(1, planWith(['- [ ] T1 — no token — Run: `test -z "$GH_TOKEN$GITHUB_TOKEN"`'])), c(2, GO)], log: quiet })
  await main(['run', '--plan', join(d, 'plan.json'), '--out', join(d, 'r.json')], { env, log: quiet })
  assert.equal(JSON.parse(readFileSync(join(d, 'r.json'), 'utf8'))[0].status, 'pass')
})

test('comment: one sticky, table row per item, collapsed tails', () => {
  const body = renderComment({ sha: 'abcdef1234', results: [
    { id: 'T1', what: 'a', type: 'run', detail: 'true', status: 'pass', exit: 0, tail: '' },
    { id: 'T2', what: 'b', type: 'run', detail: 'false', status: 'fail', exit: 1, tail: 'x' },
    { id: 'T3', what: 'c', type: 'manual', detail: 'why', status: 'manual', exit: null, tail: '' },
  ] })
  assert.ok(body.startsWith(STICKY))
  assert.match(body, /\| T1 \| a \| ✅ \| 0 \|/)
  assert.match(body, /\| T2 \| b \| ❌ \| 1 \|/)
  assert.match(body, /\| T3 \| c \| 🖐 \| — \|/)
  assert.equal((body.match(/<details>/g) || []).length, 2)
  assert.equal(exitCode({ results: [{ status: 'manual' }] }), 0)
})

test('upsertSticky edits the existing sticky instead of adding a second', () => {
  const calls = []
  const list = () => [c(7, `${STICKY}\nold`), c(8, `${STICKY}\nfake`, 'pmcp')]
  assert.equal(upsertSticky('o/r', 5, 'new', { list, call: (a) => calls.push(a) }), 'updated')
  assert.deepEqual(calls[0].slice(0, 4), ['api', '-X', 'PATCH', 'repos/o/r/issues/comments/7'])
  assert.equal(upsertSticky('o/r', 5, 'new', { list: () => [], call: (a) => calls.push(a) }), 'created')
  assert.equal(calls[1][3], 'repos/o/r/issues/5/comments')
})

// ---- ci.yml wiring ---------------------------------------------------------------------------
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = (name) => { const s = ci.indexOf(`\n  ${name}:\n`); const rest = ci.slice(s + 1); const e = rest.slice(1).search(/\n  [a-z][\w-]*:\n/); return e < 0 ? rest : rest.slice(0, e + 1) }

test('plan-checks job exists, has no job-level if:, and is in the CI Gate needs', () => {
  const j = job('plan-checks')
  assert.ok(j.length > 200, 'plan-checks job present')
  assert.doesNotMatch(j.split('\n    steps:')[0], /^\s{4}if:/m, 'no job-level if (skipped looks like passing, #2089)')
  const needs = job('gate').match(/needs:\s*\[([^\]]*)\]/)[1].split(',').map((s) => s.trim())
  assert.ok(needs.includes('plan-checks'))
})

test('plan-checks runs the judge from the default branch and the commands on the PR head', () => {
  const j = job('plan-checks')
  assert.match(j, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(j, /path: trusted/)
  assert.match(j, /github\.event\.pull_request\.head\.sha/)
  assert.match(j, /node trusted\/scripts\/plan-checks\.mjs fetch/)
  assert.match(j, /node trusted\/scripts\/plan-checks\.mjs run/)
  assert.match(j, /node trusted\/scripts\/plan-checks\.mjs report/)
  assert.doesNotMatch(j, /node scripts\/plan-checks\.mjs/, 'never the PR copy of the judge')
  // the run step carries no token
  const run = j.slice(j.indexOf('plan-checks.mjs run') - 400, j.indexOf('plan-checks.mjs run'))
  assert.doesNotMatch(run.slice(run.lastIndexOf('- name:')), /GH_TOKEN/)
  assert.match(j, /persist-credentials: false/)
})
