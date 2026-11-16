import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRunStart } from './run-start.mjs'

test('empty, undefined, whitespace are rejected', () => {
  for (const v of ['', undefined, '   ']) {
    const r = parseRunStart(v)
    assert.equal(r.ok, false)
    assert.match(r.reason, /run-start/)
  }
})

test('garbage is rejected', () => {
  assert.equal(parseRunStart('not-a-date').ok, false)
})

test('valid ISO is accepted unchanged', () => {
  const r = parseRunStart('2026-11-03T10:00:00Z')
  assert.equal(r.ok, true)
  assert.equal(r.sinceMs, Date.parse('2026-11-03T10:00:00Z'))
  assert.equal(r.since, '2026-11-03T10:00:00Z')
})
