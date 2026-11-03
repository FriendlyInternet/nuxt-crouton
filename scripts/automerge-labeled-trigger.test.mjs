import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideLeafMerge } from './lib/pr-merge-gate.mjs'

const wf = readFileSync(new URL('../.github/workflows/automerge-epic-subpr.yml', import.meta.url), 'utf8')

// Pull the job-level `if:` out of the REAL workflow and evaluate it, so the test fails if the rule changes.
const ifBlock = wf.match(/\n    if: >\n((?:      .*\n)+)/)[1]
const expr = ifBlock.replace(/\s+/g, ' ').trim().replace(/==/g, '===').replace(/!=/g, '!==')
const jobRuns = (event) => new Function('github', `return !!(${expr})`)({ event_name: 'pull_request', event })

test('pull_request trigger includes labeled', () => {
  assert.match(wf, /pull_request:\s*\n(?:\s*#.*\n)*\s*types: \[[^\]]*\blabeled\b/)
})

test('labeled: build:approved runs the job; labeled: other is skipped', () => {
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'build:approved' } }), true)
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'something-else' } }), false)
  assert.equal(jobRuns({ action: 'synchronize' }), true)
})

test('labeled: build:approved on a green, mergeable epic sub-PR reaches decideLeafMerge and merges', () => {
  const event = { action: 'labeled', label: { name: 'build:approved' } }
  assert.equal(jobRuns(event), true) // job runs -> pull_request branch makes this PR the candidate
  const gate = decideLeafMerge({
    baseRef: 'epic/1-x', headRef: 'work-1', labels: ['build:approved'],
    go: { go: false }, red: false, ciGate: 'success', mergeableState: 'clean',
  })
  assert.equal(gate.merge, true)
})

test('a skipped label event never merges (and without the label the epic sub-PR is held)', () => {
  assert.equal(jobRuns({ action: 'labeled', label: { name: 'something-else' } }), false)
  const gate = decideLeafMerge({
    baseRef: 'epic/1-x', headRef: 'work-1', labels: ['something-else'],
    go: { go: false }, red: false, ciGate: 'success', mergeableState: 'clean',
  })
  assert.equal(gate.merge, false)
})
