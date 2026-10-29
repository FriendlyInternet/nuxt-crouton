/**
 * #2431 — the pi personas live in .claude/agents/ and are rendered by pipeline-prompt.mjs.
 * Goldens = what the workflows' printf chains produced on main just before the switch, for the
 * same inputs, MINUS the shared operating contract (so editing the contract doesn't break them).
 *
 *   node --test scripts/pipeline-prompt.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderPrompt } from './pipeline-prompt.mjs'

const fx = (n) => readFileSync(new URL(`./fixtures/pipeline-prompt/${n}`, import.meta.url), 'utf8')
const contract = readFileSync(new URL('../.claude/agents/pi-operating-contract.md', import.meta.url), 'utf8')

function assertGolden(out, name) {
  assert.ok(out.startsWith(contract), 'every persona starts with the shared operating contract')
  assert.equal(out.slice(contract.length), fx(`${name}.golden.txt`))
}

test('pi-worker, off main', () => {
  assertGolden(renderPrompt('pi-worker', {
    issue: '1932', branch_instr: 'branch off main and target the PR at main',
  }), 'pi-worker')
})

test('pi-worker, off an epic branch', () => {
  assertGolden(renderPrompt('pi-worker', {
    issue: '1932', branch_instr: "branch off the integration branch 'epic/9-x' and target the PR THERE (not main)",
  }), 'pi-worker-epic')
})

test('pi-reviser passes the owner comment through verbatim (backticks, %s, {{…}}, trailing blank lines)', () => {
  assertGolden(renderPrompt('pi-reviser', { pr: '77', issue: '1932', feedback: fx('feedback.txt') }), 'pi-reviser')
})

test('pi-conflict-resolver, epic PR (#3002)', () => {
  const task = 'RESOLVE THE MERGE CONFLICT with origin/main. Write the choice file if needed.'
  const out = renderPrompt('pi-conflict-resolver', { pr: '2989', branch: 'epic/227-x', issue: '227', task, feedback: fx('feedback.txt') })
  assertGolden(out, 'pi-conflict-resolver')
  assert.ok(out.includes('RESOLVE THE MERGE CONFLICT'))
  assert.ok(out.includes('epic/227-x'))
  assert.ok(!out.split('VISUAL EVIDENCE')[0].includes('work-227'))
  assert.ok(!out.includes('QUESTION'))
  assert.ok(!/issue body/i.test(out))
})

test('pi-conflict-resolver without a task is a hard error', () => {
  assert.throws(() => renderPrompt('pi-conflict-resolver', { pr: '1', branch: 'b', issue: '1', feedback: 'x' }), /missing --var task/)
})

test('pi-decomposer (+ shared dedup rule)', () => {
  assertGolden(renderPrompt('pi-decomposer', { issue: '1932' }), 'pi-decomposer')
})

test('pi-planner (plan mode, #2755)', () => {
  assertGolden(renderPrompt('pi-planner', { issue: '1932', run_url: 'https://github.com/o/r/actions/runs/1' }), 'pi-planner')
})

test('a missing variable is a hard error, not an empty string', () => {
  assert.throws(() => renderPrompt('pi-worker', { issue: '1' }), /missing --var branch_instr/)
})
