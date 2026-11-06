/** #3208 — `work-this` is the only human dispatch label. node --test scripts/dispatch-label-wiring.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const read = f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8')
const jobIf = (src, name) => {
  const start = src.indexOf(`\n  ${name}:`)
  assert.ok(start > 0, `job ${name} exists`)
  const m = src.slice(start).match(/\n    if: \|?\s*([\s\S]*?)\n    [a-z-]+:/)
  assert.ok(m, `job ${name} has an if`)
  return m[1]
}
const labelTriggers = cond => [...cond.matchAll(/label\.name == '([^']+)'/g)].map(m => m[1])

test('work-this added → exactly one router run; the pipeline workflows are dispatch-only (#3312)', () => {
  const y = read('label-router.yml')
  assert.match(y, /types: \[labeled\]/)
  assert.ok(labelTriggers(jobIf(y, 'route')).includes('work-this'))
  for (const f of ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml']) {
    assert.doesNotMatch(read(f), /\n  issues:\n/, `${f} listens to no issue event`)
  }
  assert.equal(existsSync(new URL('../.github/workflows/plan-approved.yml', import.meta.url)), false)
})

test('a human adding only delegate-pi / plan:approved starts nothing', () => {
  const cond = jobIf(read('label-router.yml'), 'route')
  assert.match(cond, /github\.actor == 'nuxt-harness\[bot\]'/)
  assert.match(cond, /"delegate-pi"/)
  assert.match(cond, /"plan:approved"/)
  // only `work-this` fires without the bot-actor guard
  assert.deepEqual(labelTriggers(cond), ['work-this'])
})

const GONE = 'delegate-' + 'hard'
test('a label named like the retired hard lane starts no run', () => {
  for (const f of ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml', 'label-router.yml']) {
    assert.doesNotMatch(read(f), new RegExp(GONE))
  }
  assert.doesNotMatch(readFileSync(new URL('../.github/labels.yml', import.meta.url), 'utf8'), new RegExp(GONE))
})
