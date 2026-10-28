// layer: stage
/**
 * #2777 contract — when the shared-code hold releases a sub-PR.
 *
 *   node --test scripts/shared-code-hold.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideSharedCodeHold } from './shared-code-hold.mjs'

const epic = 'epic/2754-plan-before-build'
const ok = ['build:approved']

test('packages-only + build:approved merges', () => {
  assert.equal(decideSharedCodeHold({ baseRef: epic, labels: ok, files: ['packages/a/x.ts', 'docs/y.md'] }).action, 'merge')
})
test('packages-only without build:approved is held', () => {
  assert.equal(decideSharedCodeHold({ baseRef: epic, labels: [], files: ['packages/a/x.ts'] }).action, 'hold')
})
test('workflow file + build:approved is held', () => {
  const d = decideSharedCodeHold({ baseRef: epic, labels: ok, files: ['.github/workflows/a.yml'] })
  assert.equal(d.action, 'hold')
  assert.equal(decideSharedCodeHold({ baseRef: epic, labels: ok, files: ['packages/a.ts', '.github/workflows/a.yml'] }).action, 'hold')
})
test('PR into main is not handled here', () => {
  assert.equal(decideSharedCodeHold({ baseRef: 'main', labels: ok, files: ['packages/a/x.ts'] }).action, 'skip')
})
test('no shared code merges', () => {
  assert.equal(decideSharedCodeHold({ baseRef: epic, labels: [], files: ['apps/a.vue'] }).action, 'merge')
})
