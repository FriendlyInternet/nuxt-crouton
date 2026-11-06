import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldRunOnEvent } from './lib/automerge-trigger.mjs'

test('labeled + build:approved runs', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled', label: { name: 'build:approved' } }), true)
})

test('labeled + any other label is skipped', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled', label: { name: 'bug' } }), false)
  assert.equal(shouldRunOnEvent('pull_request', { action: 'labeled' }), false)
})

test('synchronize and other events run', () => {
  assert.equal(shouldRunOnEvent('pull_request', { action: 'synchronize' }), true)
  assert.equal(shouldRunOnEvent('schedule', {}), true)
})

test('workflow subscribes to labeled', () => {
  const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  assert.match(wf, /types: \[opened, ready_for_review, synchronize, labeled\]/)
})

test('job-level if filters labeled to build:approved', () => {
  const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  assert.match(wf, /github\.event\.action != 'labeled' \|\| github\.event\.label\.name == 'build:approved'/)
})

test('step imports the trigger helper unguarded (no fallback)', () => {
  const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
  assert.match(wf, /const \{ shouldRunOnEvent \} = await import\([^)]*automerge-trigger\.mjs/)
  assert.doesNotMatch(wf, /let shouldRunOnEvent = \(\) => true/)
})

// --- Evaluate the REAL job-level `if:` and run decideLeafMerge (restored from 42ce8657f) ---
import { decideLeafMerge } from './lib/pr-merge-gate.mjs'

const realWf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')
const ifBlock = realWf.match(/\n    if: >\n((?:      .*\n)+)/)[1]
const expr = ifBlock.replace(/\s+/g, ' ').trim().replace(/==/g, '===').replace(/!=/g, '!==')
const jobRuns = (event) => new Function('github', `return !!(${expr})`)({ event_name: 'pull_request', event })

test('real job `if`: labeled build:approved runs; labeled other is skipped', () => {
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'build:approved' } }), true)
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'something-else' } }), false)
  assert.equal(jobRuns({ action: 'synchronize' }), true)
})

test('labeled: build:approved on a green, mergeable epic sub-PR reaches decideLeafMerge and merges', () => {
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'build:approved' } }), true)
  const gate = decideLeafMerge({
    baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'],
    go: { go: false }, red: false, ciGate: 'success', mergeableState: 'clean',
  })
  assert.equal(gate.merge, true)
})

test('a skipped label event never merges; without the label the epic sub-PR is held', () => {
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'something-else' } }), false)
  const gate = decideLeafMerge({
    baseRef: 'epic/1-x', headRef: 'work-1', labels: ['something-else'],
    go: { go: false }, red: false, ciGate: 'success', mergeableState: 'clean',
  })
  assert.equal(gate.merge, false)
})
