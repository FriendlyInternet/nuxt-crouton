/**
 * #2060 contract — a leaf dispatch must distinguish "start this leaf from scratch" from
 * "continue this branch", so a re-run onto an already-existing work-<issue> branch/PR can't
 * silently no-op (#2012).
 *
 *   node --test scripts/leaf-mode.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseLeafMode, leafModeInstruction, START_MODE, CONTINUE_MODE } from './leaf-mode.mjs'

test('no existing branch, no PR → start mode', () => {
  assert.equal(chooseLeafMode({}).mode, START_MODE)
  assert.equal(chooseLeafMode({ hasWorkBranch: false, hasOpenPR: false }).mode, START_MODE)
})

test('an existing work-<issue> branch alone → continue mode', () => {
  assert.equal(chooseLeafMode({ hasWorkBranch: true }).mode, CONTINUE_MODE)
})

test('an existing PR alone (branch check inconclusive) → continue mode', () => {
  assert.equal(chooseLeafMode({ hasOpenPR: true }).mode, CONTINUE_MODE)
})

test('both branch and PR present → continue mode', () => {
  assert.equal(chooseLeafMode({ hasWorkBranch: true, hasOpenPR: true }).mode, CONTINUE_MODE)
})

test('start-mode instruction says to begin fresh', () => {
  const text = leafModeInstruction(START_MODE, { issue: 2060 })
  assert.match(text, /fresh leaf/i)
  assert.match(text, /#2060/)
})

test('continue-mode instruction requires reading state, forbids restarting, and requires an explicit no-op comment', () => {
  const text = leafModeInstruction(CONTINUE_MODE, { issue: 2060 })
  assert.match(text, /work-2060/)
  assert.match(text, /CONTINUE/)
  assert.match(text, /do NOT restart from scratch/i)
  // The #2060 acceptance: a silent no-op must not be possible in continue mode.
  assert.match(text, /MUST post a top-level comment/i)
  assert.match(text, /FAILED run/i)
})

// ── CLI smoke (mirrors the shape work-issue-pidev.yml would invoke it with) ──────────
test('CLI: mode subcommand round-trips flags to chooseLeafMode', async () => {
  const { execFileSync } = await import('node:child_process')
  const scriptPath = new URL('./leaf-mode.mjs', import.meta.url).pathname

  const start = execFileSync('node', [scriptPath, 'mode'], { encoding: 'utf8' })
  assert.equal(start, START_MODE)

  const cont = execFileSync('node', [scriptPath, 'mode', '--has-work-branch'], { encoding: 'utf8' })
  assert.equal(cont, CONTINUE_MODE)
})

test('CLI: instruction subcommand prints the right fragment for the issue', async () => {
  const { execFileSync } = await import('node:child_process')
  const scriptPath = new URL('./leaf-mode.mjs', import.meta.url).pathname

  const out = execFileSync('node', [scriptPath, 'instruction', '2060', '--has-open-pr'], { encoding: 'utf8' })
  assert.match(out, /work-2060/)
  assert.match(out, /CONTINUE/)
})
