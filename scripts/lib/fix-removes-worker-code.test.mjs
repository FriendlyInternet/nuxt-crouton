// layer: harness
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findRemovedWorkerLines, parseDiff } from './fix-removes-worker-code.mjs'

const hdr = f => `diff --git a/${f} b/${f}\nindex 111..222 100644\n--- a/${f}\n+++ b/${f}\n@@ -1,4 +1,4 @@\n`

// Shape of e5069974 on work-2613 ("drop stray seeAllGroup reference", PR #2684): the worker
// referenced a menu group it never defined; the fix deleted the reference.
const F = 'apps/velo/app/composables/useMenu.ts'
const workerDiff = hdr(F) + ' const groups = []\n+  groups.push(seeAllGroup)\n+  const x = 1\n'
const fixDiff = hdr(F) + ' const groups = []\n-  groups.push(seeAllGroup)\n'

test('e5069974: a fix deleting a line the worker added is refused', () => {
  const r = findRemovedWorkerLines(workerDiff, fixDiff)
  assert.equal(r.refuse, true)
  assert.deepEqual(r.removed, [{ file: F, line: '  groups.push(seeAllGroup)' }])
})

test('a fix that adds the missing piece is accepted', () => {
  const add = hdr(F) + ' const groups = []\n+const seeAllGroup = { label: "See all activity" }\n'
  assert.equal(findRemovedWorkerLines(workerDiff, add).refuse, false)
})

test('removing a line the worker did NOT add is fine', () => {
  const fix = hdr(F) + '-  const old = true\n'
  assert.equal(findRemovedWorkerLines(workerDiff, fix).refuse, false)
})

test('same text in a different file is not the worker line', () => {
  const fix = hdr('other.ts') + '-  groups.push(seeAllGroup)\n'
  assert.equal(findRemovedWorkerLines(workerDiff, fix).refuse, false)
})

test('removing a worker-added import or blank line is allowed', () => {
  const w = hdr(F) + "+import { foo } from './foo'\n+\n"
  const fix = hdr(F) + "-import { foo } from './foo'\n-\n"
  assert.equal(findRemovedWorkerLines(w, fix).refuse, false)
})

test('empty / missing diffs do not refuse', () => {
  assert.equal(findRemovedWorkerLines('', undefined).refuse, false)
  assert.deepEqual(parseDiff(''), {})
})
