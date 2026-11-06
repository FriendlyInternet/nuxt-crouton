import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFirstRun, parseFirstRunError, redAfterFirstRun } from './first-run-check.mjs'

const modErr = "Unhandled error: Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/nuxt-crouton/nuxt-crouton/scripts/lib/red-note.mjs' imported from /x/index.js"
const fnErr = 'Unhandled error: TypeError: needsLiveFilter is not a function'
const f = (path, head, main) => ({ path, head, main })
const run = (messages, files) => classifyFirstRun({ messages, files }).firstRun

test('1. module added on head, absent on main → first-run', () => {
  assert.equal(run([modErr], [f('scripts/lib/red-note.mjs', 'export function x(){}', null)]), true)
})
test('2. export only on head (function / const / list forms) → first-run', () => {
  const p = 'scripts/lib/required-check-state.mjs'
  const main = 'export function isDone(){}'
  for (const head of ['export function needsLiveFilter(){}', 'export const needsLiveFilter = 1', 'const a=1\nexport { a as needsLiveFilter }', 'export { x, needsLiveFilter }'])
    assert.equal(run([fnErr], [f(p, head, main)]), true, head)
})
test('3. same errors but already on main → blocking', () => {
  assert.equal(run([modErr], [f('scripts/lib/red-note.mjs', 'x', 'y')]), false)
  assert.equal(run([fnErr], [f('a.mjs', 'export function needsLiveFilter(){}', 'export function needsLiveFilter(){}')]), false)
})
test('4. other failures → blocking', () => {
  for (const m of ['Process completed with exit code 1', 'AssertionError: x', 'foo.bar is not a function'])
    assert.equal(run([m], [f('a.mjs', 'export function foo(){}', null)]), false)
  assert.equal(run([], []), false)
})
test('5. one first-run message plus an unrelated one → blocking', () => {
  assert.equal(run([modErr, 'Process completed with exit code 1'], [f('scripts/lib/red-note.mjs', 'x', null)]), false)
})
test('6. "does not provide an export named" → first-run', () => {
  const m = "SyntaxError: The requested module './a.mjs' does not provide an export named 'needsLiveFilter'"
  assert.equal(run([m], [f('a.mjs', 'export function needsLiveFilter(){}', 'export const z=1')]), true)
})
test('7. module not in the files list → blocking', () => {
  assert.equal(run([modErr], [f('other.mjs', 'x', null)]), false)
})
test('8. epic shape: helper on head but not main → first-run', () => {
  assert.equal(run(["Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/w/scripts/lib/x.mjs'"], [f('scripts/lib/x.mjs', 'export function f(){}', null)]), true)
})
test('parse: dotted names and non-matching text → null', () => {
  assert.equal(parseFirstRunError('a.b is not a function'), null)
  assert.equal(parseFirstRunError(''), null)
})
test('9. matched by run id: a first-run `automerge` run plus a second same-named run failing for real → blocks', () => {
  const first = { id: 1, name: 'automerge' }, real = { id: 2, name: 'automerge' }
  assert.equal(redAfterFirstRun({ redRuns: [first], firstRunRuns: [first] }), false)
  assert.equal(redAfterFirstRun({ redRuns: [first, real], firstRunRuns: [first] }), true)
  assert.equal(redAfterFirstRun({ statusRed: true, redRuns: [first], firstRunRuns: [first] }), true)
})
