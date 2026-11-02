import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tick, parse, render, marker } from './flow-checklist.mjs'

test('first tick creates the checklist with marker', () => {
  const b = tick('', 7, 'routed', { note: 'plan', link: 'http://x' })
  assert.ok(b.includes(marker(7)))
  assert.match(b, /- \[x\] Routed — plan · http:\/\/x/)
  assert.match(b, /- \[ \] Plan \+ mockup posted/)
})

test('second tick edits state, keeps earlier ticks', () => {
  const b1 = tick('', 7, 'routed', { note: 'plan' })
  const b2 = tick(b1, 7, 'plan', { link: 'http://p' })
  assert.deepEqual(Object.keys(parse(b2)), ['routed', 'plan'])
  assert.equal(b2.split(marker(7)).length, 2)
})

test('unknown step throws', () => {
  assert.throws(() => tick('', 7, 'nope'))
})

test('render with empty state ticks nothing', () => {
  assert.ok(!render(1, {}).includes('[x]'))
})
