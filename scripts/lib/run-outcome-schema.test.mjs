import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../eval-ledger/schema.mjs'

test('legacy rows validate unchanged (no run fields appear)', () => {
  const r = validate({ ts: '2026-07-01T00:00:00Z', flow: 'a11y', harness: 'pi', model: 'M' })
  assert.ok(r.ok)
  for (const k of ['run_id', 'produced', 'api_calls', 'token']) assert.equal(k in r.record, false)
})

test('per-run fields pass through; harness/model may be "unknown"', () => {
  const r = validate({ ts: '2026-11-03T00:00:00Z', flow: 'w.yml', harness: 'unknown', model: 'unknown', issue: '12', run_id: 9, produced: ['nothing'], api_calls: null, api_calls_reason: 'backfill', token: 'app', overlap: ['3'] })
  assert.ok(r.ok, JSON.stringify(r.errors))
  assert.equal(r.record.issue, 12)
  assert.equal(r.record.run_id, '9')
  assert.deepEqual(r.record.produced, ['nothing'])
  assert.equal(r.record.api_calls, null)
  assert.deepEqual(r.record.overlap, ['3'])
})
