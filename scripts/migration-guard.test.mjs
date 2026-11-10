import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSchemaChange, isAppSchemaChange, parseStatements, listTargets, evaluateMigrationGuard } from './migration-guard.mjs'

const SALES = ['packages/crouton-sales/server/db/schema.ts']
const names = { 'apps/kassa': 'kassa', 'pocs/gallery': 'gallery' }
const stmt = ['ALTER TABLE `sales_sync_status` ADD `team_id` text;']

test('isSchemaChange: owner paths true, others false', () => {
  for (const f of [
    'packages/x/server/database/schema.ts',
    'packages/x/server/database/schema/a.ts',
    'packages/x/collections/y/server/database/schema.ts',
    'packages/x/server/database/migrations/0001.sql',
    'packages/crouton-sales/server/db/schema.ts',
  ]) assert.equal(isSchemaChange([f]), true, f)
  for (const f of ['packages/crouton-sales/app/components/Sync/Status.vue', 'apps/kassa/server/db/schema.ts'])
    assert.equal(isSchemaChange([f]), false, f)
})

test('output + no migration → fail naming app and command', () => {
  const r = evaluateMigrationGuard({ changedFiles: SALES, results: { 'apps/kassa': { statements: stmt } }, names })
  assert.equal(r.status, 'fail')
  assert.equal(r.missing[0].app, 'apps/kassa')
  assert.equal(r.missing[0].command, 'pnpm --filter kassa db:generate')
  assert.match(r.markdown, /pnpm --filter kassa db:generate/)
})

test('migration included → generator empty → pass', () => {
  const r = evaluateMigrationGuard({
    changedFiles: [...SALES, 'apps/kassa/server/db/migrations/sqlite/0007_x.sql'],
    results: { 'apps/kassa': { statements: [] } }, names,
  })
  assert.equal(r.status, 'pass')
})

test('no output anywhere → pass', () => {
  const r = evaluateMigrationGuard({ changedFiles: SALES, results: { 'apps/kassa': { statements: [] }, 'pocs/gallery': { statements: [] } }, names })
  assert.equal(r.status, 'pass')
})

test('gallery: with backfill pass, without it fail (pre-existing drift is a fail)', () => {
  const ok = evaluateMigrationGuard({ changedFiles: SALES, results: { 'pocs/gallery': { statements: [] } }, names })
  assert.equal(ok.status, 'pass')
  const bad = evaluateMigrationGuard({ changedFiles: SALES, results: { 'pocs/gallery': { statements: ['CREATE TABLE `sales_sync_conflicts` (id text);'] } }, names })
  assert.equal(bad.status, 'fail')
  assert.equal(bad.missing[0].app, 'pocs/gallery')
})

test('not involved when no schema file changed', () => {
  const r = evaluateMigrationGuard({ changedFiles: ['README.md'], results: { 'apps/kassa': { statements: stmt } }, names })
  assert.equal(r.status, 'not-involved')
})

test('Migration-not-needed with reason → notice; bare → still fail', () => {
  const base = { changedFiles: SALES, results: { 'apps/kassa': { statements: stmt } }, names }
  const n = evaluateMigrationGuard({ ...base, body: 'x\nMigration-not-needed: comment-only edit\n' })
  assert.equal(n.status, 'notice')
  assert.match(n.markdown, /comment-only edit/)
  assert.equal(evaluateMigrationGuard({ ...base, body: 'Migration-not-needed:\n' }).status, 'fail')
  // regression: a bare line must not borrow the next line as its reason
  assert.equal(evaluateMigrationGuard({ ...base, body: 'Migration-not-needed:\nCloses #1' }).status, 'fail')
  assert.equal(evaluateMigrationGuard({ ...base, body: 'Migration-not-needed:   \n\nCloses #1' }).status, 'fail')
})

test('generator error fails; legacy skipped never fails alone', () => {
  const e = evaluateMigrationGuard({ changedFiles: SALES, results: { 'apps/kassa': { error: 'boom\nmore' } }, names })
  assert.equal(e.status, 'fail')
  assert.match(e.markdown, /generator failed: boom/)
  const l = evaluateMigrationGuard({ changedFiles: SALES, results: { 'pocs/pins': { skipped: 'legacy' } } })
  assert.equal(l.status, 'notice')
  assert.equal(l.skipped.length, 1)
})

test('listTargets over a tmp tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'mg-'))
  const mk = (dir, { deploy = true, gen = true, cfg } = {}) => {
    mkdirSync(join(root, dir), { recursive: true })
    if (deploy) writeFileSync(join(root, dir, 'deploy.config.json'), '{}')
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify({ name: dir.split('/')[1], scripts: gen ? { 'db:generate': 'x' } : {} }))
    if (cfg) writeFileSync(join(root, dir, 'drizzle.config.ts'), cfg)
  }
  mk('apps/good', { cfg: 'export default {}' })
  mk('apps/nogen', { gen: false })
  mk('apps/nodeploy', { deploy: false })
  mk('pocs/old', { cfg: "schema: '.nuxt/hub/db/schema.mjs'" })
  const t = listTargets(root)
  assert.deepEqual(t.map(x => [x.dir, x.legacy]), [['apps/good', false], ['pocs/old', true]])
})

test('parseStatements splits on breakpoints and drops blanks', () => {
  assert.deepEqual(parseStatements('A;\n--> statement-breakpoint\n\n--> statement-breakpoint\nB;\n'), ['A;', 'B;'])
})

test('incident replay #2726 (kassa team_id)', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/migration-guard-2726.json', import.meta.url), 'utf8'))
  const r = evaluateMigrationGuard(fx)
  assert.equal(r.status, 'fail')
  assert.ok(r.missing[0].statements.includes('ALTER TABLE `sales_sync_status` ADD `team_id` text;'))
})

test('app schema/migration files involve the guard; report says app-caused, not package-caused', () => {
  for (const f of [
    'apps/crouton-builder/server/db/schema.ts',
    'pocs/gallery/server/db/schema.ts',
    'pocs/gallery/layers/x/collections/y/server/database/schema.ts',
    'apps/crouton-builder/server/db/migrations/0003_a.sql',
    'pocs/gallery/drizzle.config.ts',
  ]) assert.equal(isAppSchemaChange([f]), true, f)
  assert.equal(isAppSchemaChange(['apps/kassa/app/app.vue']), false)
  const bad = evaluateMigrationGuard({ changedFiles: ['apps/kassa/server/db/schema.ts'], results: { 'apps/kassa': { statements: stmt } }, names })
  assert.equal(bad.status, 'fail')
  assert.match(bad.markdown, /changes an app schema/)
  const ok = evaluateMigrationGuard({ changedFiles: ['apps/kassa/server/db/schema.ts'], results: { 'apps/kassa': { statements: [] } }, names })
  assert.equal(ok.status, 'pass')
  const pkg = evaluateMigrationGuard({ changedFiles: SALES, results: { 'apps/kassa': { statements: stmt } }, names })
  assert.match(pkg.markdown, /changes a package schema/)
})
