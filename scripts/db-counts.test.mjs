/** node --test scripts/db-counts.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planCounts } from './db-counts.mjs'

test('planCounts: one COUNT per user table, no internals', () => {
  const names = ['_cf_KV', 'account', 'bookings_events', 'sqlite_sequence', 'user']
  const plan = planCounts(names)
  assert.deepEqual(plan.map(p => p.table), ['account', 'bookings_events', 'user'])
  for (const p of plan) assert.equal(p.sql, `SELECT COUNT(*) AS n FROM "${p.table}"`)
  assert.ok(!plan.some(p => p.sql.includes('_cf_KV')))
})

test('planCounts: a double quote in a name is escaped', () => {
  assert.equal(planCounts(['a"b'])[0].sql, 'SELECT COUNT(*) AS n FROM "a""b"')
})
