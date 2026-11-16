/** node --test scripts/db-counts.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planCounts, countTables, assertNoFailures } from './db-counts.mjs'

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

// The real velo-staging-db table list (29 rows) from the 5 Nov run 42049171210 that failed on `_cf_KV`.
const VELO_STAGING = ['_cf_KV', 'account', 'auth_email_log', 'bookings_bookings', 'bookings_emaillogs',
  'bookings_emailtemplates', 'bookings_locations', 'bookings_settings', 'crouton_assets', 'crouton_events',
  'crouton_operations', 'crouton_redirects', 'd1_migrations', 'domain', 'invitation', 'member', 'organization',
  'pages_pages', 'passkey', 'scopedAccessGrant', 'scopedAccessToken', 'session', 'subscription', 'team_settings',
  'translations_ui', 'twoFactor', 'user', 'user_profile', 'verification']

test('planCounts: the real velo staging list (29 rows) gives 28 statements, none for _cf_KV', () => {
  assert.equal(VELO_STAGING.length, 29)
  const plan = planCounts(VELO_STAGING)
  assert.equal(plan.length, 28)
  assert.ok(!plan.some(p => p.sql.includes('_cf_KV')))
})

test('countTables: a failing table is recorded, the rest still count, and the failure names the table', () => {
  const results = countTables('db', VELO_STAGING, (sql) => {
    if (sql.includes('"passkey"')) throw new Error('D1_ERROR: no such table: passkey\nline2')
    return [{ n: 2 }]
  })
  assert.equal(results.length, 28)
  assert.equal(results.filter(r => r.error).length, 1)
  assert.equal(results.find(r => r.table === 'user').n, 2)
  assert.throws(() => assertNoFailures(results), /1 table\(s\) failed: passkey/)
  assert.doesNotThrow(() => assertNoFailures(results.filter(r => !r.error)))
})
