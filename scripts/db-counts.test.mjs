/** node --test scripts/db-counts.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  planCounts, countTables, assertNoFailures, parseArgs, CHECKS,
  BOOKING_QUANTITY_SQL, BOOKING_QUANTITY_SQL_LEGACY, bookingQuantitySql, runBookingQuantityCheck, formatBookingQuantity
} from './db-counts.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

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

// --- booking-quantity check (#4288) ---

/** In-memory velo-shaped bookings database with the Q1 data. */
function bookingsDb() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE bookings_locations (id TEXT PRIMARY KEY, slots TEXT);
    CREATE TABLE bookings_bookings (id TEXT PRIMARY KEY, location TEXT, quantity INTEGER, status TEXT);`)
  const loc = db.prepare('INSERT INTO bookings_locations (id, slots) VALUES (?, ?)')
  loc.run('slot', '[{"id":"am"}]')
  loc.run('empty', '[]')
  loc.run('bad', 'not json')
  const bk = db.prepare('INSERT INTO bookings_bookings (id, location, quantity, status) VALUES (?, ?, ?, ?)')
  let i = 0
  for (const q of [null, 0, 1, 1, 3]) bk.run(`b${i++}`, 'slot', q, 'confirmed')
  bk.run(`b${i++}`, 'slot', 3, 'cancelled')
  bk.run(`b${i++}`, 'empty', 5, 'confirmed')
  bk.run(`b${i++}`, 'bad', 5, 'confirmed')
  return db
}

const asMap = rows => Object.fromEntries(rows.map(r => [r.amount, Number(r.n)]))
const EXPECTED = { null: 1, 0: 1, 1: 2, '2+': 1 }

test('Q1: BOOKING_QUANTITY_SQL counts slot bookings by amount, skipping cancelled and slotless locations', () => {
  const db = bookingsDb()
  assert.deepEqual(asMap(db.prepare(BOOKING_QUANTITY_SQL).all()), EXPECTED)

  // Legacy shape: an inventoryMode = 1 location with slots must not count.
  db.exec('ALTER TABLE bookings_locations ADD COLUMN inventoryMode INTEGER')
  db.prepare('INSERT INTO bookings_locations (id, slots, inventoryMode) VALUES (?, ?, 1)').run('inv', '[{"id":"am"}]')
  db.prepare('INSERT INTO bookings_bookings (id, location, quantity, status) VALUES (?, ?, ?, ?)').run('inv1', 'inv', 4, 'confirmed')
  assert.deepEqual(asMap(db.prepare(BOOKING_QUANTITY_SQL_LEGACY).all()), EXPECTED)
  assert.ok(BOOKING_QUANTITY_SQL_LEGACY.includes('COALESCE(l.inventoryMode, 0) = 0'))
})

test('Q1: bookingQuantitySql picks legacy only when the CREATE text has inventoryMode', () => {
  assert.equal(bookingQuantitySql('CREATE TABLE bookings_locations (id text, inventoryMode integer)'), BOOKING_QUANTITY_SQL_LEGACY)
  assert.equal(bookingQuantitySql('CREATE TABLE bookings_locations (id text, slots text)'), BOOKING_QUANTITY_SQL)
  assert.equal(bookingQuantitySql(undefined), BOOKING_QUANTITY_SQL)
})

test('Q1: runBookingQuantityCheck runs the real queries and reports missing tables', () => {
  assert.deepEqual(runBookingQuantityCheck(['bookings_bookings', 'user'], () => { throw new Error('must not query') }), { missing: true })

  const db = bookingsDb()
  const query = sql => db.prepare(sql).all()
  const tables = ['bookings_bookings', 'bookings_locations']
  const base = runBookingQuantityCheck(tables, query)
  assert.equal(base.legacy, false)
  assert.deepEqual(asMap(base.rows), EXPECTED)

  db.exec('ALTER TABLE bookings_locations ADD COLUMN inventoryMode INTEGER')
  db.prepare('INSERT INTO bookings_locations (id, slots, inventoryMode) VALUES (?, ?, 1)').run('inv', '[{"id":"am"}]')
  db.prepare('INSERT INTO bookings_bookings (id, location, quantity, status) VALUES (?, ?, ?, ?)').run('inv1', 'inv', 4, 'confirmed')
  const legacy = runBookingQuantityCheck(tables, query)
  assert.equal(legacy.legacy, true)
  assert.deepEqual(asMap(legacy.rows), EXPECTED)
})

test('Q2: formatBookingQuantity renders amounts in the order null, 0, 1, 2+', () => {
  const rows = bookingsDb().prepare(BOOKING_QUANTITY_SQL).all()
  assert.deepEqual(formatBookingQuantity(rows), [
    '| amount | bookings |',
    '|---|---:|',
    '| null | 1 |',
    '| 0 | 1 |',
    '| 1 | 2 |',
    '| 2+ | 1 |'
  ])
  assert.deepEqual(formatBookingQuantity([{ amount: '2+', n: 3 }]).slice(2), ['| null | 0 |', '| 0 | 0 |', '| 1 | 0 |', '| 2+ | 3 |'])
  assert.deepEqual(formatBookingQuantity([]), ['_no slot bookings_'])
})

test('Q3: parseArgs handles --check', () => {
  assert.deepEqual(CHECKS, ['booking-quantity'])
  assert.equal(parseArgs(['--check', 'booking-quantity']).check, 'booking-quantity')
  assert.equal(parseArgs(['--check=booking-quantity']).check, 'booking-quantity')
  assert.ok(!('check' in parseArgs(['--check', 'none'])))
  assert.ok(!('check' in parseArgs(['--app', 'velo'])))
  const bad = parseArgs(['--check', 'bogus'])
  assert.equal(bad.help, true)
  assert.ok(!('check' in bad))
})

test('Q3: the script exits 1 and prints HELP for --check bogus; --help still exits 0', () => {
  const run = argv => spawnSync(process.execPath, ['scripts/db-counts.mjs', ...argv], { cwd: repoRoot, encoding: 'utf8' })
  const bad = run(['--check', 'bogus', '--app', 'velo', '--env', 'staging', '--dry-run'])
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /--check <name>/)
  assert.equal(run(['--help']).status, 0)
})
