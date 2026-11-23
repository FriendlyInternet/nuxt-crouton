// #4320 — migration files in a merge conflict are never hand-merged: the pure rule, plus the
// workflow's lone-copy shape (it copies only conflict-resolution.mjs to $RUNNER_TEMP).
//   node --test scripts/conflict-resolution-migrations.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appDirOf, checkMigrationResolution, isMigrationFile, migrationDirOf, buildPrompt } from './conflict-resolution.mjs'

const D = 'apps/velo/server/db/migrations/sqlite'
const J = `${D}/meta/_journal.json`
const entry = (idx, tag) => ({ idx, version: '6', when: 1000 + idx, tag, breakpoints: true })
const journal = (tags) => JSON.stringify({ version: '7', dialect: 'sqlite', entries: tags.map((t, i) => entry(i, t)) }, null, 2) + '\n'
const BASE_TAGS = ['0000_a', '0001_b', '0002_c', '0003_d', '0004_e', '0005_f', '0006_g', '0007_omniscient_ares']
const baseFiles = (tags = BASE_TAGS, { skipSnap = [] } = {}) =>
  tags.flatMap((t, i) => [`${D}/${t}.sql`, ...(skipSnap.includes(i) ? [] : [`${D}/meta/${String(i).padStart(4, '0')}_snapshot.json`])]).concat(J)

// The good resolution: base 0007 snapshot kept, branch's migration regenerated as 0008.
function good() {
  const resolvedJ = journal([...BASE_TAGS, '0008_new'])
  return {
    conflicted: [`${D}/meta/0007_snapshot.json`],
    files: {
      [`${D}/meta/0007_snapshot.json`]: { resolved: '{"base":7}', base: '{"base":7}' },
      [J]: { resolved: resolvedJ, base: journal(BASE_TAGS) },
      [`${D}/0008_new.sql`]: { resolved: 'CREATE TABLE x();', base: null },
      [`${D}/meta/0008_snapshot.json`]: { resolved: '{"new":8}', base: null },
    },
    present: [...baseFiles(), `${D}/0008_new.sql`, `${D}/meta/0008_snapshot.json`],
  }
}

test('paths: migration files are recognised, folder and app derived', () => {
  assert.ok(isMigrationFile(`${D}/0007_x.sql`))
  assert.ok(isMigrationFile(J))
  assert.ok(isMigrationFile(`${D}/meta/0007_snapshot.json`))
  assert.ok(!isMigrationFile('scripts/fixtures/a.sql'))
  assert.ok(!isMigrationFile('apps/velo/server/db/schema.ts'))
  assert.equal(migrationDirOf(`${D}/meta/0007_snapshot.json`), D)
  assert.equal(migrationDirOf(`${D}/0007_x.sql`), D)
  assert.equal(appDirOf(D), 'apps/velo')
})

test('T1.1 snapshot resolved to the base + regenerated 0008 files and journal entry → accepted', () => {
  const r = checkMigrationResolution(good())
  assert.equal(r.applies, true)
  assert.deepEqual(r.refused, [])
  assert.deepEqual(r.apps, ['apps/velo'])
  assert.deepEqual(r.dirs, [D])
})

test('T1.2 the same conflict resolved with a merged-by-hand snapshot → refused, naming the file', () => {
  const g = good()
  g.files[`${D}/meta/0007_snapshot.json`].resolved = '{"base":7,"side":7}'
  const r = checkMigrationResolution(g)
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].file, `${D}/meta/0007_snapshot.json`)
  assert.match(r.refused[0].reason, /^hand-edited migration file: apps\/velo\/server\/db\/migrations\/sqlite\/meta\/0007_snapshot\.json/)
})

test('T1.3 a conflict only in a .sql outside a migrations folder → the rule does not apply', () => {
  assert.deepEqual(checkMigrationResolution({ conflicted: ['scripts/fixtures/a.sql'], files: {}, present: [] }), { applies: false })
})

test('T1.4a journal with an extra entry and no snapshot (the e4507d74 shape) → refused', () => {
  const g = good()
  delete g.files[`${D}/meta/0008_snapshot.json`]
  g.present = g.present.filter((p) => p !== `${D}/meta/0008_snapshot.json`)
  const r = checkMigrationResolution(g)
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].file, J)
  assert.match(r.refused[0].reason, /^hand-edited migration journal: .*0008_snapshot\.json/)
})

test('T1.4b journal with a base entry renumbered → refused', () => {
  const g = good()
  const j = JSON.parse(g.files[J].resolved)
  j.entries[7].tag = '0007_brave_gorgon'
  g.files[J].resolved = JSON.stringify(j)
  const r = checkMigrationResolution(g)
  assert.ok(r.refused.some((x) => x.file === J && /base entries were changed/.test(x.reason)), JSON.stringify(r.refused))
})

test('T1.4c a journal that does not parse → refused', () => {
  const g = good()
  g.files[J].resolved = '{ "entries": [ <<<<<<< HEAD'
  const r = checkMigrationResolution(g)
  assert.ok(r.refused.some((x) => x.file === J && /does not parse/.test(x.reason)))
})

test('T1.5 no migration conflict → the rule does not apply', () => {
  assert.deepEqual(checkMigrationResolution({ conflicted: ['a.md', 'apps/velo/server/db/schema.ts'], files: {}, present: [] }), { applies: false })
})

test('a base migration changed outside the conflict → refused (rule 3)', () => {
  const g = good()
  g.files[`${D}/0003_d.sql`] = { resolved: 'edited', base: 'orig' }
  const r = checkMigrationResolution(g)
  assert.deepEqual(r.refused.map((x) => x.file), [`${D}/0003_d.sql`])
})

test('T6a the #3961 shape: base journal + base snapshot, branch 0007_brave_gorgon.sql left → refused', () => {
  const r = checkMigrationResolution({
    conflicted: [`${D}/meta/0007_snapshot.json`],
    files: {
      [`${D}/meta/0007_snapshot.json`]: { resolved: '{"base":7}', base: '{"base":7}' },
      [J]: { resolved: journal(BASE_TAGS), base: journal(BASE_TAGS) },
      [`${D}/0007_brave_gorgon.sql`]: { resolved: 'CREATE TABLE side();', base: null },
    },
    present: [...baseFiles(), `${D}/0007_brave_gorgon.sql`],
  })
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].file, `${D}/0007_brave_gorgon.sql`)
  assert.match(r.refused[0].reason, /^migration file not in the journal/)
})

test('T6b a leftover branch meta/0008_snapshot.json with no journal entry 8 → refused, naming it', () => {
  const r = checkMigrationResolution({
    conflicted: [`${D}/meta/0007_snapshot.json`],
    files: {
      [`${D}/meta/0007_snapshot.json`]: { resolved: '{"base":7}', base: '{"base":7}' },
      [J]: { resolved: journal(BASE_TAGS), base: journal(BASE_TAGS) },
      [`${D}/meta/0008_snapshot.json`]: { resolved: '{"side":8}', base: null },
    },
    present: [...baseFiles(), `${D}/meta/0008_snapshot.json`],
  })
  assert.deepEqual(r.refused.map((x) => x.file), [`${D}/meta/0008_snapshot.json`])
  assert.match(r.refused[0].reason, /^migration file not in the journal/)
})

test('T6c a base entry with no snapshot (the kassa 0003 shape) is the base\'s history → accepted', () => {
  const g = good()
  g.present = [...baseFiles(BASE_TAGS, { skipSnap: [3] }), `${D}/0008_new.sql`, `${D}/meta/0008_snapshot.json`]
  assert.deepEqual(checkMigrationResolution(g).refused, [])
})

test('the prompt adds the migration step only for a migration conflict, naming the app\'s generator', () => {
  const p = buildPrompt({ base: 'main', files: [`${D}/meta/0007_snapshot.json`], choiceFile: '/tmp/c.md' })
  assert.ok(p.includes('5. MIGRATION FILES ARE NEVER HAND-MERGED'))
  assert.ok(p.includes('`pnpm --filter ./apps/velo db:generate`'))
  assert.ok(!buildPrompt({ base: 'main', files: ['scripts/fixtures/a.sql'], choiceFile: '/tmp/c.md' }).includes('MIGRATION FILES'))
})

// ── T5: the workflow runs a lone copy of the script, so it may import only node: built-ins plus
// ./lib/log-tail.mjs, which the workflow copies beside it (#4374) ──
const SRC = fileURLToPath(new URL('./conflict-resolution.mjs', import.meta.url))
const LOG_TAIL = fileURLToPath(new URL('./lib/log-tail.mjs', import.meta.url))
const importsOf = (file) => [...readFileSync(file, 'utf8').matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])

test('T5a every import in conflict-resolution.mjs is a node: built-in or exactly ./lib/log-tail.mjs', () => {
  const specs = importsOf(SRC)
  assert.ok(specs.length > 0)
  for (const s of specs) assert.ok(s.startsWith('node:') || s === './lib/log-tail.mjs', `non-node import: ${s}`)
})

// covers: T13
test('T13 the only non-node: import is ./lib/log-tail.mjs, and log-tail.mjs imports nothing', () => {
  assert.deepEqual(importsOf(SRC).filter((s) => !s.startsWith('node:')), ['./lib/log-tail.mjs'])
  assert.doesNotMatch(readFileSync(LOG_TAIL, 'utf8'), /^\s*import\s/m)
})

test('T5b a lone copy refuses a hand-merged snapshot mid-merge (no ERR_MODULE_NOT_FOUND)', () => {
  const lone = mkdtempSync(join(tmpdir(), 'lone-'))
  copyFileSync(SRC, join(lone, 'conflict-resolution.mjs'))
  mkdirSync(join(lone, 'lib'))
  copyFileSync(LOG_TAIL, join(lone, 'lib/log-tail.mjs'))
  const dir = mkdtempSync(join(tmpdir(), 'mig-lone-'))
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' })
  const put = (f, t) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), t) }
  const M = 'apps/x/server/db/migrations/sqlite'
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  put(`${M}/0000_a.sql`, 'a\n'); put(`${M}/meta/0000_snapshot.json`, '{"v":0}\n'); put(`${M}/meta/_journal.json`, journal(['0000_a']))
  git('add', '-A'); git('commit', '-qm', 'b0')
  git('checkout', '-qb', 'work'); put(`${M}/meta/0000_snapshot.json`, '{"v":"side"}\n'); git('commit', '-qam', 'side')
  git('checkout', '-q', 'main'); put(`${M}/meta/0000_snapshot.json`, '{"v":"base"}\n'); git('commit', '-qam', 'base')
  git('checkout', '-q', 'work')
  assert.notEqual(git('merge', '--no-edit', 'main').status, 0, 'expected a conflict')
  put(`${M}/meta/0000_snapshot.json`, '{"v":"base","w":"side"}\n')
  const v = spawnSync('node', [join(lone, 'conflict-resolution.mjs'), 'verify', join(dir, 'none.md')], { cwd: dir, encoding: 'utf8' })
  assert.doesNotMatch(v.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.equal(v.status, 1, v.stderr)
  assert.match(v.stderr, /hand-edited migration file: apps\/x\/server\/db\/migrations\/sqlite\/meta\/0000_snapshot\.json/)
})
