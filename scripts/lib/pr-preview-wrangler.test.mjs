/**
 * #2020 contract — a PR preview must be ISOLATED, not just renamed.
 *
 * The incident: PR deploys published to the app's single staging Worker and URL, so two PRs
 * clobbered each other and a merge to main overwrote both — while the PR comment described
 * the result as "isolated … its own D1 + KV". The dangerous near-fix is renaming the Worker
 * and stopping there: it looks isolated and still writes to staging's database. These tests
 * pin all three parts (name, bindings, routes) so that near-fix can't pass.
 *
 *   node --test scripts/lib/pr-preview-wrangler.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPrPreview, previewDbName } from './pr-preview-wrangler.mjs'

/** Shaped like a real built config for an app with a custom domain + provisioned bindings. */
const built = () => ({
  name: 'kassa',
  main: 'index.js',
  compatibility_flags: ['nodejs_compat'],
  routes: [{ pattern: 'kassa.pmcp.dev', custom_domain: true }],
  d1_databases: [{ binding: 'DB', database_name: 'kassa-staging-db', database_id: 'REAL-STAGING-ID' }],
  kv_namespaces: [{ binding: 'KV', id: 'REAL-KV-ID' }],
  env: { staging: { name: 'kassa-staging' } },
})

test('the Worker is renamed per PR', () => {
  const { config, name } = toPrPreview(built(), 'kassa', 2011)
  assert.equal(name, 'kassa-pr2011')
  assert.equal(config.name, 'kassa-pr2011')
})

test('D1 loses its provisioned id — otherwise the preview writes to STAGING data', () => {
  const { config } = toPrPreview(built(), 'kassa', 2011)
  const db = config.d1_databases[0]
  assert.ok(!('database_id' in db), 'database_id must be dropped so wrangler provisions a new DB')
  assert.equal(db.binding, 'DB', 'the binding name is what the code refers to — it must survive')
  assert.equal(db.database_name, 'kassa-pr2011-db')
})

test('KV loses its id too', () => {
  const { config } = toPrPreview(built(), 'kassa', 2011)
  assert.ok(!('id' in config.kv_namespaces[0]))
  assert.equal(config.kv_namespaces[0].binding, 'KV')
})

test('the custom domain is dropped — staging owns that hostname', () => {
  const { config } = toPrPreview(built(), 'kassa', 2011)
  assert.ok(!('routes' in config))
  assert.ok(!('route' in config))
  assert.equal(config.workers_dev, true, 'the workers.dev URL is the deliverable')
})

test('any nested env block is dropped — it would smuggle the staging bindings back in', () => {
  const { config } = toPrPreview(built(), 'kassa', 2011)
  assert.ok(!('env' in config))
})

test('no staging identifier survives anywhere in the output', () => {
  // The blunt end-to-end assertion: if any real id or the staging DB name is still present,
  // the preview is not isolated, however tidy the individual fields look.
  const { config } = toPrPreview(built(), 'kassa', 2011)
  const json = JSON.stringify(config)
  for (const leak of ['REAL-STAGING-ID', 'REAL-KV-ID', 'kassa-staging-db', 'kassa.pmcp.dev']) {
    assert.ok(!json.includes(leak), `preview config still references ${leak}`)
  }
})

test('two PRs on one app never collide', () => {
  const a = toPrPreview(built(), 'kassa', 2011)
  const b = toPrPreview(built(), 'kassa', 2012)
  assert.notEqual(a.name, b.name)
  assert.notEqual(a.config.d1_databases[0].database_name, b.config.d1_databases[0].database_name)
})

test('the input config is not mutated', () => {
  // The caller may still need the original (e.g. to report what staging looks like).
  const original = built()
  toPrPreview(original, 'kassa', 2011)
  assert.equal(original.name, 'kassa')
  assert.equal(original.d1_databases[0].database_id, 'REAL-STAGING-ID')
})

test('a config with no bindings or routes is handled', () => {
  const { config } = toPrPreview({ name: 'poc', main: 'index.js' }, 'poc', 7)
  assert.equal(config.name, 'poc-pr7')
  assert.equal(config.workers_dev, true)
})

test('the migrate step derives the same DB name as the deploy', () => {
  // Deriving this in two places is exactly how they drift.
  const { config } = toPrPreview(built(), 'kassa', 2011)
  assert.equal(previewDbName('kassa', 2011, 'DB'), config.d1_databases[0].database_name)
})

test('a non-numeric PR is refused rather than producing a junk Worker name', () => {
  assert.throws(() => toPrPreview(built(), 'kassa', 'main'), TypeError)
  assert.throws(() => toPrPreview(built(), 'kassa', '../evil'), TypeError)
})
