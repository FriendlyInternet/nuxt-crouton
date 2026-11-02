/** #3194 — the plan's Test checklist.  node --test scripts/lib/plan-checklist.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseChecklist } from './plan-checklist.mjs'
import { parsePlan, PLAN_MARKER } from './plan-shape.mjs'

const OK = '- [ ] T1 — rule holds — Run: `node --test a.mjs`\n- [ ] T2 — looks right — Manual: visual'

test('valid checklist parsed in order', () => {
  const r = parseChecklist(OK)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.items.map((i) => [i.id, i.type]), [['T1', 'run'], ['T2', 'manual']])
  assert.equal(r.items[0].detail, 'node --test a.mjs')
})
test('line missing Run/Manual is an error', () => {
  assert.ok(parseChecklist('- [ ] T1 — does a thing').errors.length)
})
test('duplicate id is an error', () => {
  assert.ok(parseChecklist(OK + '\n- [ ] T2 — again — Manual: x').errors.some((e) => /duplicate/.test(e)))
})
test('prose without checklist is an error', () => {
  assert.ok(parseChecklist('foo.test.ts').errors.length)
})

const plan = (test_) => `${PLAN_MARKER}
### Reproduced
yes — ran it, saw failure
### Cause
x
### Fix
x
### Files
- a
### Test
${test_}
### Assumptions
none
### Needs owner
no — mechanical`
test('plan-shape: Manual-only and T0 are valid; prose or no Test section is rejected', () => {
  assert.equal(parsePlan(plan(OK)).ok, true)
  assert.equal(parsePlan(plan('- [ ] T1 — look — Manual: x')).ok, true)
  assert.equal(parsePlan(plan('- [ ] T0 — no runnable test — Manual: docs only')).ok, true)
  assert.equal(parsePlan(plan('- [ ] T0 — no runnable test — Run: `x`')).ok, false)
  assert.equal(parsePlan(plan(OK + '\n- [ ] T0 — none — Manual: x')).ok, false)
  assert.equal(parsePlan(plan('write foo.test.ts')).ok, false)
  assert.equal(parsePlan(plan(OK).replace('### Test', '### Nope')).ok, false)
})
