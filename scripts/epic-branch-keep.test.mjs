// The "is the epic still open → keep the branch" decision (#2788).
//   node --test scripts/epic-branch-keep.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldKeepEpicBranch } from './epic-branch-keep.mjs'

test('keeps the branch while the epic is open', () => {
  assert.equal(shouldKeepEpicBranch('epic/2706-pipeline-tightening-friction', 'open'), true)
  assert.equal(shouldKeepEpicBranch('epic/2706-x', 'OPEN'), true)
})

test('lets the branch go once the epic is closed', () => {
  assert.equal(shouldKeepEpicBranch('epic/2706-x', 'closed'), false)
  assert.equal(shouldKeepEpicBranch('epic/2706-x', 'CLOSED'), false)
})

test('keeps when the epic state is unknown (safe default)', () => {
  assert.equal(shouldKeepEpicBranch('epic/2706-x', null), true)
  assert.equal(shouldKeepEpicBranch('epic/2706-x', undefined), true)
})

test('non-epic branches are not covered by this rule', () => {
  assert.equal(shouldKeepEpicBranch('work-2788', 'open'), false)
  assert.equal(shouldKeepEpicBranch('main', 'open'), false)
})
