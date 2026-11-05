/** #3208 — `work-this` is the only human dispatch label. node --test scripts/dispatch-label-wiring.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8')
const jobIf = (src, name) => {
  const start = src.indexOf(`\n  ${name}:`)
  assert.ok(start > 0, `job ${name} exists`)
  const m = src.slice(start).match(/\n    if: \|?\s*([\s\S]*?)\n    [a-z-]+:/)
  assert.ok(m, `job ${name} has an if`)
  return m[1]
}
const labelTriggers = cond => [...cond.matchAll(/label\.name == '([^']+)'/g)].map(m => m[1])

test('work-this added → exactly one route run (worker job never takes the label directly for epics)', () => {
  const y = read('work-issue-pidev.yml')
  const routeIf = jobIf(y, 'route')
  assert.deepEqual(labelTriggers(routeIf), ['work-this'])
  assert.match(routeIf, /action == 'labeled'/)
})

test('a human adding only delegate-pi starts nothing', () => {
  const cond = jobIf(read('decompose-on-issue-pidev.yml'), 'decompose-pi')
  assert.match(cond, /github\.actor == 'nuxt-harness\[bot\]'/)
  assert.match(cond, /"delegate-pi"/)
  // no branch fires on a label without the bot-actor guard
  assert.doesNotMatch(cond, /label\.name == '[^']+'\)\s*\|\|/)
})

const GONE = 'delegate-' + 'hard'
test('a label named like the retired hard lane starts no run', () => {
  for (const f of ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml']) {
    assert.doesNotMatch(read(f), new RegExp(GONE))
  }
  assert.doesNotMatch(readFileSync(new URL('../.github/labels.yml', import.meta.url), 'utf8'), new RegExp(GONE))
})
