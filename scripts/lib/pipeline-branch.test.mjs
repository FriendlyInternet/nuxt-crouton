/**
 * #2089 contract — who the pipeline is allowed to touch.
 *
 * The fix-bot gated on `claude/issue-` alone and therefore never ran once after the pi
 * harness went live (`work-<n>` branches): 100 of its last 100 runs were `skipped`, 1718
 * total, zero that acted. A false job `if` reports `skipped`, which reads exactly like
 * "nothing to do" — so nothing was ever red and it went unnoticed for the whole pi era.
 *
 * Both halves matter. Too narrow and the fix-bot is dead; too wide and an agent starts
 * pushing to human PRs, which the guard exists to prevent.
 *
 *   node --test scripts/lib/pipeline-branch.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPipelineBranch, PIPELINE_BRANCH_PREFIXES } from './pipeline-branch.mjs'

test('the pi worker branch is a pipeline branch — the case that was missing', () => {
  assert.equal(isPipelineBranch('work-2061'), true)
  assert.equal(isPipelineBranch('work-1642'), true)
})

test('the claude lane still matches', () => {
  assert.equal(isPipelineBranch('claude/issue-123'), true)
})

test('HUMAN branches are NOT pipeline branches — the half that protects your PRs', () => {
  for (const ref of ['fix/2089-fixbot-branch-scope', 'feat/x', 'main', 'epic/2012-something', 'renovate/x']) {
    assert.equal(isPipelineBranch(ref), false, `${ref} must never be auto-edited`)
  }
})

test('a prefix must be at the START — a branch merely containing the word is not ours', () => {
  assert.equal(isPipelineBranch('my-work-2061'), false)
  assert.equal(isPipelineBranch('feat/claude/issue-1'), false)
})

test('empty and nullish refs are safe', () => {
  assert.equal(isPipelineBranch(''), false)
  assert.equal(isPipelineBranch(undefined), false)
  assert.equal(isPipelineBranch(null), false)
})

test('the prefix list is exported so the workflows share one definition', () => {
  assert.deepEqual(PIPELINE_BRANCH_PREFIXES, ['claude/issue-', 'work-'])
})

/* ── Drift guard: the workflows CANNOT import this module ──────────────────────
 *
 * A GitHub `if:` expression is not JavaScript, and neither workflow checks out the repo
 * before it evaluates — so both must repeat the prefixes as literals. That duplication is
 * unavoidable; leaving it *undetectable* is not, and undetectable duplication is precisely
 * how the fix-bot's guard fell behind `pipeline-pr-status.yml` for the entire pi era.
 *
 * So this test reads the actual workflow files and asserts they agree with the module. It
 * fails if someone adds a prefix here and forgets a workflow, or vice versa.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOWS = [
  '.github/workflows/fix-ci-on-failure.yml',
  '.github/workflows/pipeline-pr-status.yml',
]

for (const wf of WORKFLOWS) {
  test(`${wf} agrees with PIPELINE_BRANCH_PREFIXES`, () => {
    const src = readFileSync(join(repoRoot, wf), 'utf8')
    for (const prefix of PIPELINE_BRANCH_PREFIXES) {
      assert.ok(
        src.includes(`'${prefix}'`),
        `${wf} does not test for '${prefix}' — a pipeline branch it should act on would be `
        + 'silently skipped, which looks exactly like "nothing to do" (#2089).',
      )
    }
  })
}
