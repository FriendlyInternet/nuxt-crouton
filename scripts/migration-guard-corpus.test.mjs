import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSchemaChange } from './migration-guard.mjs'
import {
  mergeShaLists, collectPrs, parseFileList, diffStatements, classifyPr, computeTotals, renderReport,
} from './migration-guard-corpus.mjs'

const STMT = 'ALTER TABLE sales_sync_status ADD team_id text;'
const SCHEMA_FILE = 'packages/crouton-sales/server/database/schema.ts'
const drift = Array.from({ length: 14 }, (_, i) => `CREATE INDEX i${i} ON t(c);`)

test('pre-existing drift is not blamed on the PR', () => {
  const r = { 'pocs/gallery': { statements: drift } }
  const c = classifyPr({ merge: r, parent: r, prFiles: [SCHEMA_FILE] })
  assert.equal(c.guard, 'fail')
  assert.deepEqual(c.flagged, [])
  assert.equal(c.preExistingOnly, true)
})

test('new statements are flagged as likely real', () => {
  const c = classifyPr({
    merge: { 'apps/kassa': { statements: [STMT] } }, parent: { 'apps/kassa': { statements: [] } }, prFiles: [SCHEMA_FILE],
  })
  assert.equal(c.flagged.length, 1)
  assert.match(c.flagged[0].verdict, /^likely real/)
})

test('a hand-written migration makes it a likely false alarm', () => {
  const c = classifyPr({
    merge: { 'apps/kassa': { statements: [STMT] } }, parent: { 'apps/kassa': { statements: [] } },
    prFiles: [SCHEMA_FILE, 'apps/kassa/server/db/migrations/sqlite/0008_x.sql'],
  })
  assert.match(c.flagged[0].verdict, /^likely false alarm/)
})

test('a new error is flagged, an old error is not', () => {
  assert.deepEqual(Object.keys(diffStatements({ a: { error: 'boom' } }, { a: { statements: [] } })), ['a'])
  assert.deepEqual(diffStatements({ a: { error: 'boom' } }, { a: { error: 'boom' } }), {})
})

test('a clean merge needs no parent', () => {
  const c = classifyPr({ merge: { 'apps/kassa': { statements: [] } }, parent: undefined, prFiles: [SCHEMA_FILE] })
  assert.equal(c.clean, true)
})

test('unmeasurable rows render with their reason and totals are right', () => {
  const real = classifyPr({ merge: { 'apps/kassa': { statements: [STMT] } }, parent: {}, prFiles: [SCHEMA_FILE] })
  const fa = classifyPr({ merge: { 'apps/velo': { statements: [STMT] } }, parent: {}, prFiles: [SCHEMA_FILE, 'apps/velo/server/db/migrations/0004.sql'] })
  const rows = [
    { pr: 1, merged: '2026-01-01', base: 'main', classified: real },
    { pr: 2, merged: '2026-01-02', base: 'main', classified: fa },
    { pr: 3, reason: 'not measurable — every target was legacy (skipped)' },
  ]
  assert.deepEqual(computeTotals(rows), { fired: 2, real: 1, falseAlarm: 1, preExisting: 0 })
  const md = renderReport(rows, { head: 'abc' })
  assert.match(md, /#3 — not measurable — every target was legacy/)
})

test('file-list parsing keeps every page', () => {
  const lines = Array.from({ length: 154 }, (_, i) => (i === 120 ? SCHEMA_FILE : `docs/f${i}.md`))
  const files = parseFileList(lines.join('\n') + '\n')
  assert.equal(files.length, 154)
  assert.equal(isSchemaChange(files), true)
})

test('discovery keeps roll-up merges and drops unmerged PRs', () => {
  assert.deepEqual(mergeShaLists(['aaa', 'bbb'], ['ccc', 'aaa']), ['aaa', 'bbb', 'ccc'])
  const table = { aaa: [{ number: 2726, merged_at: 'x' }], bbb: [], ccc: [{ number: 2984, merged_at: 'y' }, { number: 9, merged_at: null }] }
  assert.deepEqual(collectPrs(['aaa', 'bbb', 'ccc'], s => table[s]), [2984, 2726])
})

test('roll-ups are not double counted', () => {
  const c = () => classifyPr({ merge: { 'apps/kassa': { statements: [STMT] } }, parent: {}, prFiles: [SCHEMA_FILE] })
  const rows = [
    { pr: 2726, merged: 'a', base: 'epic/801', classified: c() },
    { pr: 2984, merged: 'b', base: 'main', classified: c(), rollupOf: [2726] },
  ]
  assert.equal(computeTotals(rows).real, 1)
  assert.match(renderReport(rows), /roll-up of #2726/)
})
