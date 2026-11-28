/**
 * #3086 contract — the parked-ticket walk (`releaseWaiting`) runs in ONE serialised place,
 * release-waiting.yml, and every workflow that walks calls it. Reads the real workflow files
 * (dependency-free, no YAML parser — the scripts-tests job runs with no install).
 *
 *   node --test scripts/release-waiting-wiring.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { RELEASE_ON_UNLABEL, SCOPE_PREFIXES } from './traffic-control.mjs'

const DIR = new URL('../.github/workflows/', import.meta.url)
const read = (f) => readFileSync(new URL(f, DIR), 'utf8')

/** The text of one job (`  <id>:` at 2 spaces) up to the next job or top-level key. */
function job(text, id) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l === `  ${id}:`)
  assert.ok(start >= 0, `job ${id} not found`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^  [A-Za-z0-9_-]+:\s*$/.test(l) || /^\S/.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

// covers: T2
test('release-waiting.yml is workflow_call only, with the release-waiting group that never cancels', () => {
  const wf = read('release-waiting.yml')
  assert.match(wf, /^on:\n  workflow_call:/m)
  assert.doesNotMatch(wf, /^  (issues|pull_request|workflow_dispatch|schedule|push):/m)
  const walk = job(wf, 'walk')
  assert.match(walk, /concurrency:\n      group: release-waiting\n      cancel-in-progress: false/)
  assert.match(walk, /releaseWaiting\(/)
  assert.match(walk, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(walk, /persist-credentials: false/)
})

// covers: T2
test('no other workflow calls releaseWaiting', () => {
  const callers = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f) && f !== 'release-waiting.yml')
    // a call or an import, not a mention in a `#` comment
    .filter((f) => read(f).split('\n').some((l) => !/^\s*#/.test(l) && /releaseWaiting\b/.test(l)))
  assert.deepEqual(callers, [])
})

// covers: T2
for (const [file, id] of [
  ['on-pr-close.yml', 'release-traffic'],
  ['on-issue-close.yml', 'release-traffic'],
  ['build-review.yml', 'release-traffic'],
  ['work-issue-pidev.yml', 'release-traffic'],
]) {
  test(`${file} ${id} uses release-waiting.yml`, () => {
    const j = job(read(file), id)
    assert.match(j, /^    uses: \.\/\.github\/workflows\/release-waiting\.yml$/m)
    assert.match(j, /^    secrets: inherit$/m)
    assert.match(j, /issues: write/)
  })
}

// covers: T2
test('build-review and work-issue-pidev keep their warn-only walk (soft: true)', () => {
  for (const file of ['build-review.yml', 'work-issue-pidev.yml']) {
    assert.match(job(read(file), 'release-traffic'), /with:\n      soft: true/, file)
  }
})

// covers: T2
test('on-issue-close release-traffic unlabel filter equals RELEASE_ON_UNLABEL + SCOPE_PREFIXES', () => {
  const j = job(read('on-issue-close.yml'), 'release-traffic')
  const m = j.match(/fromJSON\('(\[[^']*\])'\), github\.event\.label\.name\)/)
  assert.ok(m, 'fromJSON label list not found')
  assert.deepEqual(JSON.parse(m[1]), RELEASE_ON_UNLABEL)
  const prefixes = [...j.matchAll(/startsWith\(github\.event\.label\.name, '([^']+)'\)/g)].map((x) => x[1])
  assert.deepEqual(prefixes, SCOPE_PREFIXES)
  assert.match(j, /github\.event\.action == 'closed'/)
  assert.match(j, /github\.event\.action == 'edited' && contains\(github\.event\.issue\.labels\.\*\.name, 'status:blocked'\)/)
  assert.match(j, /github\.event\.action == 'unlabeled'/)
})

// covers: T2
test('on-issue-close release only runs on a close (Blocked-by dependents)', () => {
  const j = job(read('on-issue-close.yml'), 'release')
  assert.match(j, /if: github\.event_name == 'issues' && github\.event\.action == 'closed'/)
  assert.match(j, /releaseReady\(/)
})

// covers: T2
test('on-pr-close release-traffic skips only when close-linked-issues succeeded and closed an issue', () => {
  const wf = read('on-pr-close.yml')
  const j = job(wf, 'release-traffic')
  assert.match(j, /needs: close-linked-issues/)
  assert.match(j, /always\(\)/)
  assert.match(j, /needs\.close-linked-issues\.result == 'success'/)
  assert.match(j, /needs\.close-linked-issues\.outputs\.closed != ''/)
  assert.match(j, /needs\.close-linked-issues\.outputs\.closed != '0'/)
  const c = job(wf, 'close-linked-issues')
  assert.match(c, /closed: \$\{\{ steps\.close\.outputs\.closed \}\}/)
  assert.match(c, /id: close/)
  assert.match(c, /core\.setOutput\('closed', String\(await closeLinkedIssues\(/)
})
