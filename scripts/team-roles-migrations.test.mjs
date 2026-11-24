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

// T5 (#4283) — every app whose migrations create organizationRole also adds
// `removedActions` (what a team's owner took from its admin row) in exactly one
// journaled migration that does nothing else, with a snapshot that has it.
const ADD_REMOVED = /ALTER\s+TABLE\s+`organizationRole`\s+ADD\s+`removedActions`/i

const withOrgRole = migrationDirs().filter(dir =>
  sqlFiles(dir).some(f => /CREATE TABLE `organizationRole`/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
)

for (const dir of withOrgRole) {
  const app = path.relative(ROOT, dir).split(path.sep).slice(0, 2).join('/')
  // covers: T5
  test(`${app} adds organizationRole.removedActions in its own journaled migration`, () => {
    const hits = sqlFiles(dir).filter(f => ADD_REMOVED.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    assert.equal(hits.length, 1, `${app}: expected exactly one migration adding removedActions, found ${hits.length}`)
    const file = hits[0]

    const statements = fs.readFileSync(path.join(dir, file), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean)
    assert.equal(statements.length, 1, `${app}/${file} must hold only the ALTER TABLE … ADD`)
    assert.match(statements[0], ADD_REMOVED)

    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'))
    const entry = journal.entries.find(e => e.tag === file.replace(/\.sql$/, ''))
    assert.ok(entry, `${app}: ${file} is not in meta/_journal.json`)
    const snapshot = path.join(dir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`)
    assert.ok(fs.existsSync(snapshot), `${app}: missing ${path.basename(snapshot)}`)
    assert.ok(JSON.parse(fs.readFileSync(snapshot, 'utf8')).tables.organizationRole?.columns?.removedActions, `${app}: snapshot lacks organizationRole.removedActions`)
  })
}
