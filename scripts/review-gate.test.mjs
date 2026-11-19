import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markersToDelete, markerFor, decide, workflowIsStale } from './review-gate.mjs'

const script = new URL('./review-gate.mjs', import.meta.url).pathname
const reviewers = ['red-team', 'a11y', 'frontend-review', 'simplify']
const dir = mkdtempSync(join(tmpdir(), 'review-gate-'))
// No GITHUB_REPOSITORY: the command line then skips the "older workflow than main" lookup (#4237),
// so these tests never touch the network and never depend on the branch they run on.
const env = { ...process.env, GITHUB_REPOSITORY: '' }
const run = (reviewer, file, cls = 'no_verdict') =>
  spawnSync('node', [script, reviewer, file, cls], { encoding: 'utf8', env })

for (const r of reviewers) {
  test(`${r}: missing verdict fails and names the reviewer`, () => {
    const res = run(r, join(dir, 'nope.json'))
    assert.equal(res.status, 1)
    assert.match(res.stdout, new RegExp(r))
  })
  test(`${r}: unparseable verdict fails`, () => {
    const f = join(dir, `${r}-bad.json`)
    writeFileSync(f, '{not json')
    assert.equal(run(r, f).status, 1)
  })
  test(`${r}: valid verdict passes`, () => {
    const f = join(dir, `${r}-ok.json`)
    writeFileSync(f, JSON.stringify({ highest: 'none' }))
    assert.equal(run(r, f).status, 0)
  })
}

test('classifications render plain language, no raw enum', () => {
  for (const c of ['billing_error', 'error_max_turns', 'no_verdict', 'something_else']) {
    const out = run('a11y', join(dir, 'nope.json'), c).stdout
    assert.doesNotMatch(out, /billing_error|error_max_turns|no_verdict|something_else/)
  }
  assert.match(run('a11y', join(dir, 'nope.json'), 'billing_error').stdout, /out of credit/)
})

test('simplify with a critical finding still passes', () => {
  const f = join(dir, 'simplify-crit.json')
  writeFileSync(f, JSON.stringify({ highest: 'critical' }))
  assert.equal(run('simplify', f).status, 0)
})

test('markersToDelete returns every comment of that reviewer only', () => {
  const comments = [
    { id: 1, body: `x ${markerFor('a11y')}` },
    { id: 2, body: `y ${markerFor('a11y')}` },
    { id: 3, body: `z ${markerFor('simplify')}` },
    { id: 4, body: 'plain' },
  ]
  assert.deepEqual(markersToDelete(comments, 'a11y').map(c => c.id), [1, 2])
})

test('review.yml gate steps are skipped on cancel, not run under always()', () => {
  const yml = readFileSync(new URL('../.github/workflows/review.yml', import.meta.url), 'utf8')
  const steps = yml.split('\n      - ').filter(s => /gate-outage-check|scripts\/review-gate\.mjs/.test(s))
  assert.equal(steps.length, 8)
  for (const s of steps) {
    assert.match(s, /if: \$\{\{ !cancelled\(\) \}\}/)
    assert.doesNotMatch(s, /if: always\(\)/)
  }
})

test('a no-verdict run gets the single fallback message', () => {
  const log = join(dir, 'agent-ok.log')
  writeFileSync(log, 'all good')
  const res = spawnSync('node', [script, 'frontend-review', join(dir, 'nope.json'), 'no_verdict', log], { encoding: 'utf8', env })
  assert.equal(res.status, 1)
  assert.match(res.stdout, /did not run \(refused, crashed or out of credit — the action reports no reason\)\. This PR is not approved; open the run, fix the cause, re-run\./)
})

// Advice never blocks: red-team, a11y and simplify only advise. frontend-review is decided by a
// text rule (scripts/frontend-gate.mjs), so it is the only reviewer that may go red.
test('advisory reviewers: "did not run" says it does not block; frontend-review says not approved', () => {
  for (const r of ['red-team', 'a11y', 'simplify']) {
    const out = run(r, join(dir, 'nope.json')).stdout
    assert.match(out, /does not block/)
    assert.doesNotMatch(out, /not approved/)
  }
  assert.match(run('frontend-review', join(dir, 'nope.json')).stdout, /not approved/)
})

test('review.yml: only frontend-review can turn the check red', () => {
  const yml = readFileSync(new URL('../.github/workflows/review.yml', import.meta.url), 'utf8')
  const job = name => yml.split(new RegExp(`\\n  ${name}:\\n`))[1].split(/\n  [a-z0-9-]+:\n/)[0]
  for (const r of ['red-team', 'a11y', 'simplify']) {
    const gate = job(r).split('\n      - ').find(s => s.includes('scripts/review-gate.mjs'))
    assert.doesNotMatch(gate, /exit 1/, `${r} must not exit 1`)
    assert.doesNotMatch(gate, /HIGHEST/, `${r} must not read the model's verdict line`)
  }
  assert.match(job('frontend-review'), /exit 1/)
})

// #4237: the Claude review tool refuses to run when the branch's review.yml differs from main's.
test('workflowIsStale: only when both versions are known and differ', () => {
  assert.equal(workflowIsStale({ localSha: 'aaa', mainSha: 'bbb' }), true)
  assert.equal(workflowIsStale({ localSha: 'aaa', mainSha: 'aaa' }), false)
  assert.equal(workflowIsStale({ localSha: '', mainSha: 'bbb' }), false)
  assert.equal(workflowIsStale({ localSha: 'aaa', mainSha: undefined }), false)
  assert.equal(workflowIsStale({}), false)
})

test('no verdict on a branch with an older review workflow: the message says bring main in', () => {
  const missing = join(dir, 'nope.json')
  const fe = decide({ reviewer: 'frontend-review', verdictPath: missing, workflowStale: true })
  assert.equal(fe.pass, false)
  assert.match(fe.message, /review workflow differs from the one on `main`/)
  assert.match(fe.message, /Bring `main` into/)
  assert.match(fe.message, /not approved/)
  assert.doesNotMatch(fe.message, /reports no reason/)
  assert.ok(fe.message.includes(markerFor('frontend-review')))

  const adv = decide({ reviewer: 'simplify', verdictPath: missing, workflowStale: true })
  assert.equal(adv.pass, false)
  assert.match(adv.message, /Bring `main` into/)
  assert.match(adv.message, /does not block/)
  assert.doesNotMatch(adv.message, /not approved/)
})

test('no verdict, workflow not older: the message is unchanged', () => {
  const m = decide({ reviewer: 'frontend-review', verdictPath: join(dir, 'nope.json'), workflowStale: false }).message
  assert.match(m, /reports no reason/)
  assert.doesNotMatch(m, /Bring `main` into/)
})

test('a verdict passes even when the workflow is older', () => {
  const f = join(dir, 'stale-ok.json')
  writeFileSync(f, '{"findings":[]}')
  assert.deepEqual(decide({ reviewer: 'frontend-review', verdictPath: f, workflowStale: true }), { pass: true, message: '' })
})
