// #4317: the fix-bot's still-red precheck and the one reason a fixer run records when it pushed no fix.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideStillRed, stillRed, packagesAllowedFor, noCommitReason, NO_COMMIT_REASONS } from './fix-bot-precheck.mjs'

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
/** A stub of the github-script `github` client: `paginate` returns `jobs`, or throws. */
const gh = (jobs, calls = []) => ({
  rest: { actions: { listJobsForWorkflowRun: 'listJobs' } },
  paginate: async (fn, args) => { calls.push({ fn, args }); if (jobs instanceof Error) throw jobs; return jobs },
})
const run = { id: 7, head_sha: SHA }

// ── T1: rules 1–5, through stillRed (the call the gate makes) ──
test('rule 1: the failed run is now all success on the same commit → no run, already-green', async () => {
  const calls = []
  const r = await stillRed({ github: gh([{ name: 'lint', conclusion: 'success' }, { name: 'docs', conclusion: 'skipped' }], calls), owner: 'o', repo: 'r', run, headSha: SHA })
  assert.deepEqual(r, { run: false, reason: 'already-green' })
  assert.deepEqual(calls[0].args, { owner: 'o', repo: 'r', run_id: 7, filter: 'latest', per_page: 100 })
})

test('rule 2: the PR head is not the failed commit → no run, head-moved (no API read)', async () => {
  const calls = []
  const r = await stillRed({ github: gh([], calls), owner: 'o', repo: 'r', run, headSha: OTHER })
  assert.deepEqual(r, { run: false, reason: 'head-moved' })
  assert.equal(calls.length, 0)
})

test('rule 3: still failure → run, still-red', async () => {
  assert.deepEqual(await stillRed({ github: gh([{ name: 'lint', conclusion: 'failure' }]), owner: 'o', repo: 'r', run, headSha: SHA }), { run: true, reason: 'still-red' })
})

test('rule 4: two checks, one still red → run', async () => {
  const r = await stillRed({ github: gh([{ name: 'lint', conclusion: 'success' }, { name: 'test', conclusion: 'failure' }]), owner: 'o', repo: 'r', run, headSha: SHA })
  assert.deepEqual(r, { run: true, reason: 'still-red' })
})

test('rule 5: the jobs cannot be read → run (fail open), check-unreadable', async () => {
  const r = await stillRed({ github: gh(new Error('502')), owner: 'o', repo: 'r', run, headSha: SHA })
  assert.deepEqual(r, { run: true, reason: 'check-unreadable' })
})

test('an empty job list and an in-progress re-run both fail open → run', async () => {
  assert.deepEqual(await stillRed({ github: gh([]), owner: 'o', repo: 'r', run, headSha: SHA }), { run: true, reason: 'still-red' })
  assert.deepEqual(await stillRed({ github: gh([{ name: 'lint', conclusion: null }]), owner: 'o', repo: 'r', run, headSha: SHA }), { run: true, reason: 'still-red' })
  assert.deepEqual(decideStillRed({ failedSha: SHA, headSha: SHA, checks: null }), { run: true, reason: 'check-unreadable' })
})

test('packagesAllowedFor: pkg:* labels unlock those names; an epic head or no issue never does', async () => {
  const github = { rest: { issues: { get: async () => ({ data: { labels: [{ name: 'pkg:auth' }, 'pkg:i18n', { name: 'type:fix' }] } }) } } }
  assert.deepEqual(await packagesAllowedFor({ github, owner: 'o', repo: 'r', issueNumber: 5, head: 'work-5' }), { allowed: 'true', names: 'auth i18n' })
  assert.deepEqual(await packagesAllowedFor({ github, owner: 'o', repo: 'r', issueNumber: 5, head: 'epic/5-x' }), { allowed: 'false', names: '' })
  assert.deepEqual(await packagesAllowedFor({ github, owner: 'o', repo: 'r', issueNumber: null, head: 'work-5' }), { allowed: 'false', names: '' })
  const warned = []
  const broken = { rest: { issues: { get: async () => { throw new Error('boom') } } } }
  assert.deepEqual(await packagesAllowedFor({ github: broken, owner: 'o', repo: 'r', issueNumber: 5, head: 'work-5', warn: (m) => warned.push(m) }), { allowed: 'false', names: '' })
  assert.match(warned[0], /pkg-label check #5: boom/)
})

// ── T2: rule 6, one exact code per exit path ──
const go = (fixOutputs, { fixResult = 'success', fixbot = {} } = {}) => ({
  fixbot: { result: 'success', outputs: { proceed: 'true', mode: 'fix', ...fixbot } },
  fix: { result: fixResult, outputs: fixOutputs },
})
const stop = (skip_reason) => ({ fixbot: { result: 'success', outputs: { proceed: 'false', skip_reason } }, fix: { result: 'skipped', outputs: {} } })
const diag = (extra = {}, fixOutputs = {}) => ({
  fixbot: { result: 'success', outputs: { proceed: 'true', mode: 'diagnose', diagnosed: 'true', ...extra } },
  fix: { result: 'success', outputs: fixOutputs },
})

const ROWS = [
  ['fixbot job failed', { fixbot: { result: 'failure', outputs: {} } }, 'run-failed'],
  ...['not-eligible', 'no-failed-run', 'blocked', 'not-watched', 'not-failure', 'gave-up', 'already-diagnosed', 'already-green', 'head-moved']
    .map(c => [`gate stop ${c}`, stop(c), c]),
  ['same failure on base', go({}, { fixbot: { base_skip: 'true' } }), 'same-on-base'],
  ['diagnose with no diagnosis', diag({ diagnosed: 'false' }), 'diagnosis-missing'],
  ['diagnose, fix not approved', diag({}, { go: 'false', moved: 'false' }), 'diagnosis-not-approved'],
  ['fix job failed', go({}, { fixResult: 'failure' }), 'run-failed'],
  ['fix job cancelled', go({}, { fixResult: 'cancelled' }), 'run-failed'],
  ['head moved in job fix', go({ moved: 'true' }), 'head-moved'],
  ['guard refused (refusal wins over commit)', go({ go: 'true', moved: 'false', refused: 'true', committed: 'true' }), 'guard-refused'],
  ['model wrote no fix', go({ go: 'true', moved: 'false' }), 'model-no-change'],
  ['committed and pushed', go({ go: 'true', moved: 'false', committed: 'true', pushed: 'true' }), null],
  ['pushed without committed is never model-no-change', go({ go: 'true', moved: 'false', pushed: 'true' }), null],
]

for (const [name, needs, expected] of ROWS) {
  test(`noCommitReason: ${name} → ${expected}`, () => assert.equal(noCommitReason(needs), expected))
}

test('noCommitReason: no listed path returns unknown, and every reason but unknown is reachable', () => {
  const got = ROWS.map(([, n]) => noCommitReason(n))
  assert.ok(!got.includes('unknown'))
  assert.deepEqual(new Set(got.filter(Boolean)), new Set(NO_COMMIT_REASONS.filter(c => c !== 'unknown')))
})

test('noCommitReason: a gate stop with no skip_reason is the only way to unknown', () => {
  assert.equal(noCommitReason({ fixbot: { result: 'success', outputs: { proceed: 'false' } } }), 'unknown')
  assert.equal(noCommitReason({}), 'unknown')
})
