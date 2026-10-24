import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderPrompt } from './pipeline-prompt.mjs'

// Goldens = the prompts the workflows' printf chains produced before #2431 (issue 1932).
const golden = (n) => readFileSync(new URL(`./fixtures/pipeline-prompt/${n}.golden.txt`, import.meta.url), 'utf8')

test('pi-worker renders byte-identical to the pre-refactor printf output', () => {
  const out = renderPrompt('pi-worker', {
    issue: '1932',
    branch_instr: 'branch off main and target the PR at main',
  })
  assert.equal(out, golden('pi-worker'))
})

test('pi-decomposer (+ shared dedup rule) renders byte-identical', () => {
  assert.equal(renderPrompt('pi-decomposer', { issue: '1932' }), golden('pi-decomposer'))
})

test('a missing variable is a hard error, not an empty string', () => {
  assert.throws(() => renderPrompt('pi-worker', { issue: '1' }), /missing --var branch_instr/)
})
