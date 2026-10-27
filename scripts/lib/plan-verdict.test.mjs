// Rubric fixtures for the plan reviewer verdict (#2756). node --test scripts/lib/plan-verdict.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseVerdict, precheck, decide, renderComment } from './plan-verdict.mjs'

const fx = (n) => readFileSync(new URL(`../fixtures/plan-review/${n}`, import.meta.url), 'utf8')

test('a clean plan with a clean verdict is go', () => {
  const d = decide(fx('clean.plan.md'), fx('pass.verdict.md'))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'go')
  assert.deepEqual(d.failed, [])
})

test('replay of the "refresh keys" plan (#2701): no-go on items 1 and 2 even when the model says go', () => {
  const d = decide(fx('refresh-keys.plan.md'), fx('lenient.verdict.md'))
  assert.equal(d.ok, true)
  assert.equal(d.verdict, 'no-go')
  assert.ok(d.failed.includes('1'))
  assert.ok(d.failed.includes('2'))
})

test('"Reproduced: no" with no reason is no-go citing item 1', () => {
  const plan = fx('clean.plan.md').replace(/yes\. Booted[^\n]*/, 'no')
  assert.ok(precheck(plan)['1'])
  assert.equal(decide(plan, fx('pass.verdict.md')).verdict, 'no-go')
})

test('hedging words in Cause fail item 2', () => {
  const plan = fx('clean.plan.md').replace('The list query key omits', 'The list query key probably omits')
  assert.ok(precheck(plan)['2'])
})

test('an unverified assumption fails item 3; a verified one without a link fails 1b', () => {
  assert.ok(precheck(fx('refresh-keys.plan.md'))['3'])
  const plan = fx('clean.plan.md').replace(/Evidence: https:\/\/\S+/, 'Evidence: grep output')
  assert.ok(precheck(plan)['1b'])
})

test('a clean plan has no deterministic failures', () => {
  assert.deepEqual(precheck(fx('clean.plan.md')), {})
})

test('item 7 FAIL with a question is needs-owner', () => {
  const d = decide(fx('clean.plan.md'), fx('owner.verdict.md'))
  assert.equal(d.verdict, 'needs-owner')
  assert.match(d.question, /yes\/no/)
})

test('needs-owner without a Question is rejected', () => {
  const v = fx('owner.verdict.md').replace(/### Question[\s\S]*/, '')
  assert.equal(decide(fx('clean.plan.md'), v).ok, false)
})

test('a reviewer that says go while its own rubric fails is rejected, not trusted', () => {
  const v = fx('pass.verdict.md').replace('- 4: PASS — one-line key change', '- 4: FAIL — a helper already exists')
  assert.equal(decide(fx('clean.plan.md'), v).ok, false)
})

test('a malformed verdict (missing marker, item, evidence, bad verdict) is rejected', () => {
  assert.equal(parseVerdict('nothing here').ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('- 6: PASS — only useList touched\n', '')).ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('- 5: PASS — no casts or timeouts', '- 5: PASS')).ok, false)
  assert.equal(parseVerdict(fx('pass.verdict.md').replace('go\n', 'maybe\n')).ok, false)
})

test('the comment carries the marker, the type and a collapsed checklist', () => {
  const c = renderComment(decide(fx('clean.plan.md'), fx('pass.verdict.md')), { model: 'x' })
  assert.match(c, /<!-- plan-review:v1 -->/)
  assert.match(c, /Plan approved/)
  assert.match(c, /<details>/)
})
