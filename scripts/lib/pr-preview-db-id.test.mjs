/**
 * #2085 contract — the preview must migrate its OWN database, or say why it can't.
 *
 * The gap: #2020 strips `database_id` so wrangler auto-provisions a fresh DB per PR, and
 * #2079 points the migrate at that same built config because it is the only place the
 * PR-scoped name lives. Both correct; together they leave the migrate with a name and no
 * id, which remote D1 operations require. This resolves it between the two.
 *
 * The failure mode to protect against is NOT the error — it is the quiet success: a
 * preview whose migrations were skipped serves an empty database behind a link that looks
 * fine. That is #2078, which went unnoticed for weeks. So an unresolved name must be loud.
 *
 *   node --test scripts/lib/pr-preview-db-id.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyD1Ids } from './pr-preview-db-id.mjs'

const built = () => ({
  name: 'velo-pr2080',
  d1_databases: [{ binding: 'DB', database_name: 'velo-pr2080-db', migrations_dir: '/abs/migrations' }],
})

test('the provisioned id is written in, matched by name', () => {
  const cfg = built()
  const r = applyD1Ids(cfg, [{ name: 'velo-pr2080-db', uuid: 'UUID-1' }])
  assert.equal(cfg.d1_databases[0].database_id, 'UUID-1')
  assert.deepEqual(r.missing, [])
  assert.deepEqual(r.resolved, ['velo-pr2080-db → UUID-1'])
})

test('`id` is accepted as well as `uuid` — wrangler has used both', () => {
  const cfg = built()
  applyD1Ids(cfg, [{ name: 'velo-pr2080-db', id: 'ID-1' }])
  assert.equal(cfg.d1_databases[0].database_id, 'ID-1')
})

test('THE LOUD CASE — an unmatched name is reported, not silently skipped', () => {
  const cfg = built()
  const r = applyD1Ids(cfg, [{ name: 'some-other-db', uuid: 'x' }])
  assert.deepEqual(r.missing, ['velo-pr2080-db'])
  assert.equal(cfg.d1_databases[0].database_id, undefined, 'must not invent an id')
})

test('an empty d1 list is a miss, not a pass', () => {
  assert.deepEqual(applyD1Ids(built(), []).missing, ['velo-pr2080-db'])
  assert.deepEqual(applyD1Ids(built(), null).missing, ['velo-pr2080-db'])
})

test('a binding that already has an id is left alone — never overwritten', () => {
  const cfg = built()
  cfg.d1_databases[0].database_id = 'PRE-EXISTING'
  const r = applyD1Ids(cfg, [{ name: 'velo-pr2080-db', uuid: 'DIFFERENT' }])
  assert.equal(cfg.d1_databases[0].database_id, 'PRE-EXISTING')
  assert.deepEqual(r.resolved, [])
  assert.deepEqual(r.alreadySet, ['velo-pr2080-db'])
})

test('a binding with no database_name is a miss and names the binding', () => {
  const cfg = { d1_databases: [{ binding: 'DB' }] }
  assert.match(applyD1Ids(cfg, [{ name: 'x', uuid: 'y' }]).missing[0], /binding DB/)
})

test('multiple bindings resolve independently, and one miss still reports', () => {
  const cfg = { d1_databases: [
    { binding: 'DB', database_name: 'a-db' },
    { binding: 'DB2', database_name: 'b-db' },
  ] }
  const r = applyD1Ids(cfg, [{ name: 'a-db', uuid: 'A' }])
  assert.equal(cfg.d1_databases[0].database_id, 'A')
  assert.deepEqual(r.missing, ['b-db'])
})

test('no d1 bindings at all is a clean no-op (pocs/loop-station has none)', () => {
  const r = applyD1Ids({ name: 'x' }, [])
  assert.deepEqual(r, { resolved: [], missing: [], alreadySet: [] })
})
