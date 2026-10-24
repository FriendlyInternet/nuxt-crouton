/**
 * Contract for the squash schema differ (#1717).
 *
 * The headline case is the real one: kassa's `0019_nullable_printer_location` fixed
 * `sales_printers.locationId` in the DATABASE but never in the schema source, so the
 * #1455 squash silently reverted it and the production restore died on real rows.
 * If this file's `reproduces the kassa regression` test ever goes green-by-accident,
 * the differ has stopped doing the one job it exists for.
 *
 *   node --test scripts/schema-diff.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalTables, diffSchemas } from './schema-diff.mjs'

// ── the kassa history, reduced to the shape that matters ─────────────────────
// 0016 rebuilt the table with locationId NOT NULL (the regression);
// 0019 rebuilt it again with locationId nullable (the corrective fix).
const OLD_HISTORY = `
CREATE TABLE \`sales_printers\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`locationId\` text NOT NULL,
  \`title\` text NOT NULL
);
PRAGMA foreign_keys=OFF;
CREATE TABLE \`__new_sales_printers\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`locationId\` text,
  \`title\` text NOT NULL
);
INSERT INTO \`__new_sales_printers\` SELECT * FROM \`sales_printers\`;
DROP TABLE \`sales_printers\`;
ALTER TABLE \`__new_sales_printers\` RENAME TO \`sales_printers\`;
PRAGMA foreign_keys=ON;
`

// The regenerated baseline: built from the schema source, which still said notNull().
const NEW_BASELINE = `
CREATE TABLE \`sales_printers\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`locationId\` text NOT NULL,
  \`title\` text NOT NULL
);
`

// What the live database actually looked like (post-0019): nullable, and rows use it.
const LIVE_DUMP = `
CREATE TABLE \`sales_printers\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`locationId\` text,
  \`title\` text NOT NULL
);
INSERT INTO "sales_printers" VALUES('p1',NULL,'Receipt');
`

test('replays a drizzle table rebuild to its FINAL shape (not a spurious drop)', () => {
  const t = finalTables(OLD_HISTORY)
  assert.ok(t.sales_printers, 'sales_printers survived the DROP + RENAME')
  assert.equal(t.sales_printers.locationId, 'text', '0019 left it nullable')
  assert.ok(!Object.keys(t).some(n => n.startsWith('__new')), 'no __new_* leaks into the result')
})

test('reproduces the kassa regression: the squash reverts 0019 to NOT NULL', () => {
  const { columns } = diffSchemas(OLD_HISTORY, NEW_BASELINE)
  const hit = columns.find(c => c.table === 'sales_printers' && c.column === 'locationId')
  assert.ok(hit, 'the differ must notice locationId at all')
  assert.equal(hit.kind, 'changed')
  assert.match(hit.after, /NOT NULL/i)
  assert.doesNotMatch(hit.before, /NOT NULL/i)
})

test('a table-NAME diff would have missed it — the table exists on both sides', () => {
  const { droppedTables, addedTables } = diffSchemas(OLD_HISTORY, NEW_BASELINE)
  assert.deepEqual(droppedTables, [], 'no table dropped…')
  assert.deepEqual(addedTables, [], '…and none added — which is why names alone are blind')
})

test('flags the restore blocker when the live dump is supplied', () => {
  const { blockers } = diffSchemas(OLD_HISTORY, NEW_BASELINE, LIVE_DUMP)
  const b = blockers.find(x => x.table === 'sales_printers' && x.column === 'locationId')
  assert.ok(b, 'NOT NULL in the baseline vs a nullable live column must block')
})

test('without --live it still flags a nullable→NOT NULL change, marked as needing confirmation', () => {
  const { blockers } = diffSchemas(OLD_HISTORY, NEW_BASELINE)
  assert.equal(blockers.length, 1)
  assert.match(blockers[0].reason, /--live/)
})

test('a NOT NULL column WITH a default is not a blocker', () => {
  const oldS = 'CREATE TABLE `t` (`id` text PRIMARY KEY NOT NULL);'
  const newS = 'CREATE TABLE `t` (`id` text PRIMARY KEY NOT NULL, `role` text DEFAULT \'user\' NOT NULL);'
  const live = 'CREATE TABLE `t` (`id` text PRIMARY KEY NOT NULL);'
  assert.deepEqual(diffSchemas(oldS, newS, live).blockers, [])
})

test('a live column absent from the new baseline blocks the restore', () => {
  const oldS = 'CREATE TABLE `t` (`id` text NOT NULL, `gone` text);'
  const newS = 'CREATE TABLE `t` (`id` text NOT NULL);'
  const live = 'CREATE TABLE `t` (`id` text NOT NULL, `gone` text);'
  const { blockers } = diffSchemas(oldS, newS, live)
  assert.equal(blockers.length, 1)
  assert.equal(blockers[0].column, 'gone')
})

test('the triage case: added nullable columns are NOT blockers', () => {
  // What #1456 actually looked like — new columns the live DB lacks, all nullable.
  const oldS = 'CREATE TABLE `team_settings` (`id` text NOT NULL);'
  const newS = 'CREATE TABLE `team_settings` (`id` text NOT NULL, `notion_settings` text);'
  const live = 'CREATE TABLE `team_settings` (`id` text NOT NULL);'
  const { columns, blockers } = diffSchemas(oldS, newS, live)
  assert.equal(columns.filter(c => c.kind === 'added').length, 1)
  assert.deepEqual(blockers, [], 'nullable additions load fine — this is why triage was cleared')
})
