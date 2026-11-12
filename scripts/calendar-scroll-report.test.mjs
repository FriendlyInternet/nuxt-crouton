import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLines, summarize, renderSection, spliceBody, assertDeploySucceeded } from './calendar-scroll-report.mjs'

// Real lines as the deployed spec prints them (staging, WebKit, before the fix, #3813).
const LOG = `
[webkit-iphone] › builder swipe
CALSCROLL target=staging engine=webkit app=crouton-builder case=swipe scroller=window before=291 after=0 month=2026-11→2026-12 wrongFrames=0 result=fail
CALSCROLL cleanup builder page → HTTP 200
CALSCROLL target=staging engine=webkit app=crouton-builder case=swipe scroller=window before=291 after=291 month=2026-11→2026-12 wrongFrames=0 result=pass
CALSCROLL target=staging engine=webkit app=booking-demo case=swipe scroller=DIV.flex.h-full.w-full before=149 after=65 month=2026-11→2026-12 wrongFrames=0 result=fail
`

test('parseLines reads every result line and skips cleanup lines', () => {
  const runs = parseLines(LOG)
  assert.equal(runs.length, 3)
  assert.deepEqual(
    { app: runs[0].app, case: runs[0].case, before: runs[0].before, after: runs[0].after, result: runs[0].result },
    { app: 'crouton-builder', case: 'swipe', before: '291', after: '0', result: 'fail' },
  )
})

test('summarize counts failures per app+case', () => {
  assert.deepEqual(summarize(parseLines(LOG)), [
    { app: 'crouton-builder', case: 'swipe', runs: 2, failed: 1 },
    { app: 'booking-demo', case: 'swipe', runs: 1, failed: 1 },
  ])
})

test('renderSection names the engine and shows the per-run numbers', () => {
  const s = renderSection(parseLines(LOG), 'staging')
  assert.match(s, /Engine: \*\*webkit\*\*/)
  assert.match(s, /\| crouton-builder swipe \| 1 \| 2 \|/)
  assert.match(s, /\| 1 \| crouton-builder swipe \| 291 → 0 \|/)
})

test('renderSection with no lines says the test did not run (never an empty green)', () => {
  assert.match(renderSection([], 'preview'), /did not run/)
})

test('spliceBody appends once, then replaces in place, keeping the Closes line', () => {
  const body = 'Closes #3813\n\nWorkflow-change: yes'
  const once = spliceBody(body, 'staging', 'A')
  assert.ok(once.startsWith('Closes #3813'))
  assert.match(once, /<!-- calendar-scroll:staging -->\nA\n<!-- \/calendar-scroll:staging -->/)
  const twice = spliceBody(once, 'staging', 'B')
  assert.equal(twice.match(/<!-- calendar-scroll:staging -->/g).length, 1)
  assert.match(twice, /\nB\n/)
  assert.ok(!twice.includes('\nA\n'))
  const other = spliceBody(twice, 'preview', 'C')
  assert.match(other, /\nB\n/)
  assert.match(other, /\nC\n/)
})

// Real entry point: the workflow file wires these rules, read it and check them.
test('a preview deploy that did not succeed fails the preview job (plan Test 3)', () => {
  const ok = { databaseId: 1, status: 'completed', conclusion: 'success' }
  assert.equal(assertDeploySucceeded(ok), ok)
  for (const conclusion of ['failure', 'cancelled', 'timed_out', null]) {
    assert.throws(() => assertDeploySucceeded({ databaseId: 2, status: 'completed', conclusion }), /concluded/)
  }
  assert.throws(() => assertDeploySucceeded(null), /concluded/)
})

const WF = readFileSync(new URL('../.github/workflows/calendar-scroll.yml', import.meta.url), 'utf8')

test('workflow: runs on PRs that touch the calendar package or the spec', () => {
  assert.match(WF, /pull_request:/)
  assert.match(WF, /'packages\/crouton-calendar\/\*\*'/)
  assert.match(WF, /'e2e\/deployed\/\*\*'/)
})

test('workflow: every browser run has a hard time limit', () => {
  const jobs = WF.split(/\n  [a-z-]+:\n    name:/).length - 1
  assert.ok(jobs >= 2)
  assert.equal((WF.match(/timeout-minutes:/g) || []).length >= jobs, true)
  assert.match(WF, /timeout -k 10 \d+ pnpm exec playwright test --config e2e\/deployed\/playwright\.config\.ts/)
})

test('workflow: the staging baseline never blocks, the preview job does', () => {
  const staging = WF.slice(WF.indexOf('staging-baseline:'), WF.indexOf('preview:'))
  const preview = WF.slice(WF.indexOf('preview:'))
  assert.match(staging, /continue-on-error: true/)
  assert.doesNotMatch(preview, /continue-on-error: true/)
  assert.match(preview, /CAL_SCROLL_TARGET: pr/)
  assert.match(staging, /CAL_SCROLL_TARGET: staging/)
})

test('workflow: both jobs write their numbers into the PR body', () => {
  assert.equal((WF.match(/calendar-scroll-report\.mjs report/g) || []).length, 2)
  assert.match(WF, /calendar-scroll-report\.mjs preview-urls/)
})
