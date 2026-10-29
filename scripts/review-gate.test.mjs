import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markersToDelete, markerFor } from './review-gate.mjs'

const script = new URL('./review-gate.mjs', import.meta.url).pathname
const reviewers = ['red-team', 'a11y', 'frontend-review', 'simplify']
const dir = mkdtempSync(join(tmpdir(), 'review-gate-'))
const run = (reviewer, file, cls = 'no_verdict') =>
  spawnSync('node', [script, reviewer, file, cls], { encoding: 'utf8' })

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
  const res = spawnSync('node', [script, 'simplify', join(dir, 'nope.json'), 'no_verdict', log], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.match(res.stdout, /did not run \(refused, crashed or out of credit — the action reports no reason\)\. This PR is not approved; open the run, fix the cause, re-run\./)
})
