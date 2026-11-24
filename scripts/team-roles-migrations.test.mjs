// T6 (#4106) — every app whose migrations create the `member` table also has a
// migration that creates `organizationRole` (Better Auth dynamic access
// control), listed in its drizzle journal, and that migration creates nothing
// else. Without the table every team permission check with a Better Auth
// context errors, so an app missing it breaks invites and role changes.
//
// Scans the real migration folders under apps/, pocs/ and fixtures/ (skipping
// local `.data/` copies). Run: node --test scripts/team-roles-migrations.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOPS = ['apps', 'pocs', 'fixtures']

/** Every `<app>/server/db/migrations/sqlite` folder under the three tops. */
function migrationDirs() {
  const dirs = []
  for (const top of TOPS) {
    const base = path.join(ROOT, top)
    if (!fs.existsSync(base)) continue
    for (const app of fs.readdirSync(base)) {
      const dir = path.join(base, app, 'server/db/migrations/sqlite')
      if (fs.existsSync(dir)) dirs.push(dir)
    }
  }
  return dirs
}

function sqlFiles(dir) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
}

const CREATE = /CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX)\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`(?:\s+ON\s+`([^`]+)`)?/gi

/** The tables a migration touches with CREATE TABLE / CREATE INDEX … ON. */
function createdTables(sql) {
  const tables = new Set()
  for (const m of sql.matchAll(CREATE)) tables.add(m[2] ?? m[1])
  return tables
}

const withMember = migrationDirs().filter(dir =>
  sqlFiles(dir).some(f => /CREATE TABLE `member`/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
)

test('the scan finds the apps that have a member table', () => {
  // 2 apps + 11 pocs + 9 fixtures at the time of #4106; more is fine, far fewer means the scan broke.
  assert.ok(withMember.length >= 22, `found only ${withMember.length} apps with a member table`)
})

for (const dir of withMember) {
  const app = path.relative(ROOT, dir).split(path.sep).slice(0, 2).join('/')
  test(`${app} creates organizationRole in its own journaled migration`, () => {
    const hits = sqlFiles(dir).filter(f => /CREATE TABLE `organizationRole`/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    assert.equal(hits.length, 1, `${app}: expected exactly one migration creating organizationRole, found ${hits.length}`)
    const file = hits[0]

    const tables = createdTables(fs.readFileSync(path.join(dir, file), 'utf8'))
    assert.deepEqual([...tables], ['organizationRole'], `${app}/${file} must create only organizationRole`)

    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'))
    const tag = file.replace(/\.sql$/, '')
    const entry = journal.entries.find(e => e.tag === tag)
    assert.ok(entry, `${app}: ${tag} is not in meta/_journal.json`)
    const snapshot = path.join(dir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`)
    assert.ok(fs.existsSync(snapshot), `${app}: missing ${path.basename(snapshot)}`)
    assert.ok(JSON.parse(fs.readFileSync(snapshot, 'utf8')).tables.organizationRole, `${app}: snapshot lacks organizationRole`)
  })
}

// T5 (#4283) — every app whose migrations create organizationRole also gives it
// `removedActions` (what a team's owner took from its admin row) in exactly one
// journaled migration, with a snapshot that has the column. Two shapes count
// (#4497): a separate `ALTER TABLE … ADD` migration that does nothing else (the
// epic's own history), or the column inside the organizationRole CREATE TABLE —
// what drizzle writes when a fresh merge regenerates the migrations from main's
// journal (green field; owner ok in
// https://github.com/FriendlyInternet/nuxt-crouton/issues/4497#issuecomment-7137551225).
// An app with neither shape (or both) stays red.
const ADD_REMOVED = /ALTER\s+TABLE\s+`organizationRole`\s+ADD\s+`removedActions`/i
const CREATE_ORG_ROLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`organizationRole`/i

function statementsOf(sql) {
  return sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
}

/**
 * Why a migration folder fails the removedActions rule, or null when it passes.
 * @param {string} dir  a `server/db/migrations/sqlite` folder
 * @param {string} label  name used in the messages
 * @returns {string | null}
 */
export function removedActionsProblem(dir, label) {
  const hits = []
  for (const file of sqlFiles(dir)) {
    const statements = statementsOf(fs.readFileSync(path.join(dir, file), 'utf8'))
    if (statements.some(s => ADD_REMOVED.test(s))) hits.push({ file, shape: 'alter', statements })
    else if (statements.some(s => CREATE_ORG_ROLE.test(s) && s.includes('`removedActions`'))) hits.push({ file, shape: 'create', statements })
  }
  if (hits.length !== 1) {
    return `${label}: expected exactly one migration giving organizationRole a removedActions column (ALTER … ADD, or inside its CREATE TABLE), found ${hits.length}`
  }
  const { file, shape, statements } = hits[0]
  // The create shape needs no extra rule: T6 already checks that migration creates only organizationRole.
  if (shape === 'alter' && statements.length !== 1) return `${label}/${file} must hold only the ALTER TABLE … ADD`

  const journalPath = path.join(dir, 'meta/_journal.json')
  const journal = fs.existsSync(journalPath) ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : { entries: [] }
  const entry = journal.entries.find(e => e.tag === file.replace(/\.sql$/, ''))
  if (!entry) return `${label}: ${file} is not in meta/_journal.json`
  const snapshot = path.join(dir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`)
  if (!fs.existsSync(snapshot)) return `${label}: missing ${path.basename(snapshot)}`
  if (!JSON.parse(fs.readFileSync(snapshot, 'utf8')).tables?.organizationRole?.columns?.removedActions) {
    return `${label}: snapshot lacks organizationRole.removedActions`
  }
  return null
}

const withOrgRole = migrationDirs().filter(dir =>
  sqlFiles(dir).some(f => /CREATE TABLE `organizationRole`/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
)

for (const dir of withOrgRole) {
  const app = path.relative(ROOT, dir).split(path.sep).slice(0, 2).join('/')
  // #4283 T5 — per-app corpus check
  test(`${app} adds organizationRole.removedActions in its own journaled migration`, () => {
    assert.equal(removedActionsProblem(dir, app), null)
  })
}

// Synthetic folders for the shapes the real corpus may not (yet) hold (#4497).
const CREATE_WITH = 'CREATE TABLE `organizationRole` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`role` text NOT NULL,\n\t`removedActions` text\n);\n--> statement-breakpoint\nCREATE INDEX `organizationRole_organizationId_idx` ON `organizationRole` (`organizationId`);'
const CREATE_WITHOUT = 'CREATE TABLE `organizationRole` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`role` text NOT NULL\n);'
const ALTER = 'ALTER TABLE `organizationRole` ADD `removedActions` text;'

/** A temp migrations folder: `files` is { name: sql }, `journaled` the names listed in the journal. */
function fixture(files, journaled = Object.keys(files)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-roles-'))
  fs.mkdirSync(path.join(dir, 'meta'))
  const entries = []
  Object.entries(files).forEach(([name, sql], idx) => {
    fs.writeFileSync(path.join(dir, name), sql)
    if (!journaled.includes(name)) return
    entries.push({ idx, tag: name.replace(/\.sql$/, '') })
    const snapshot = { tables: { organizationRole: { columns: { id: {}, role: {}, removedActions: {} } } } }
    fs.writeFileSync(path.join(dir, `meta/${String(idx).padStart(4, '0')}_snapshot.json`), JSON.stringify(snapshot))
  })
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ entries }))
  return dir
}

// covers: T1
test('removedActions inside the organizationRole CREATE TABLE, journaled with a snapshot, is accepted', () => {
  assert.equal(removedActionsProblem(fixture({ '0000_large_carnage.sql': CREATE_WITH }), 'x'), null)
})

// covers: T2
test('an organizationRole CREATE without removedActions and no ALTER is red with found 0', () => {
  assert.match(removedActionsProblem(fixture({ '0000_team_roles.sql': CREATE_WITHOUT }), 'x') ?? '', /found 0/)
})

// covers: T3
test('a separate ALTER … ADD removedActions migration is still accepted', () => {
  const dir = fixture({ '0000_team_roles.sql': CREATE_WITHOUT, '0001_admin_removed_actions.sql': ALTER })
  assert.equal(removedActionsProblem(dir, 'x'), null)
})

// covers: T4
test('both shapes in one app (the column added twice) is red with found 2', () => {
  const dir = fixture({ '0000_large_carnage.sql': CREATE_WITH, '0001_admin_removed_actions.sql': ALTER })
  assert.match(removedActionsProblem(dir, 'x') ?? '', /found 2/)
})

// covers: T5
test('a CREATE-with-column migration missing from meta/_journal.json is red', () => {
  const dir = fixture({ '0000_large_carnage.sql': CREATE_WITH }, [])
  assert.match(removedActionsProblem(dir, 'x') ?? '', /not in meta\/_journal\.json/)
})
