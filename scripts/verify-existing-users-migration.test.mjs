// #3141 — turning on e-mail verification would lock out every existing password user
// (the column defaults to false and sign-up never sent a verification e-mail). Each
// app/POC/fixture migration history therefore carries a data-only backfill that marks
// existing users verified. This test proves (1) every folder has exactly one, as its
// newest migration, and (2) the real SQL, run on a real sqlite DB, verifies everyone.
//
// Run: node --test scripts/verify-existing-users-migration.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Every app/POC/fixture with a sqlite migration history (#3141 plan, Fix 5).
const FOLDERS = [
  'apps/kassa', 'apps/velo',
  'pocs/alexdeforce', 'pocs/booking-demo', 'pocs/crate', 'pocs/crouton-builder', 'pocs/gallery',
  'pocs/kvr', 'pocs/notes', 'pocs/pins', 'pocs/sintlukas', 'pocs/snippets', 'pocs/status',
  'fixtures/minimal', 'fixtures/with-assets', 'fixtures/with-bookings', 'fixtures/with-collab',
  'fixtures/with-devtools', 'fixtures/with-maps', 'fixtures/with-pages', 'fixtures/with-sales'
]

const migrationsDir = folder => path.join(ROOT, folder, 'server/db/migrations/sqlite')

function backfillFile(folder) {
  const files = fs.readdirSync(migrationsDir(folder)).filter(f => f.endsWith('_verify_existing_users.sql'))
  assert.equal(files.length, 1, `${folder}: expected exactly one *_verify_existing_users.sql, found ${files.length}`)
  return files[0]
}

test('the list covers every sqlite migration folder in the repo', () => {
  const found = []
  for (const top of ['apps', 'pocs', 'fixtures']) {
    for (const name of fs.readdirSync(path.join(ROOT, top))) {
      if (fs.existsSync(migrationsDir(`${top}/${name}`))) found.push(`${top}/${name}`)
    }
  }
  assert.deepEqual(found.sort(), [...FOLDERS].sort())
})

for (const folder of FOLDERS) {
  test(`${folder}: the backfill is the newest migration, with a chained snapshot`, () => {
    const file = backfillFile(folder)
    const dir = migrationsDir(folder)
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'))
    const last = journal.entries.at(-1)
    assert.equal(last.tag, file.replace(/\.sql$/, ''), `${folder}: backfill must be the last journal entry`)
    assert.equal(last.idx, journal.entries.at(-2).idx + 1)

    const nnnn = String(last.idx).padStart(4, '0')
    const prevNnnn = String(last.idx - 1).padStart(4, '0')
    const snap = JSON.parse(fs.readFileSync(path.join(dir, `meta/${nnnn}_snapshot.json`), 'utf8'))
    const prev = JSON.parse(fs.readFileSync(path.join(dir, `meta/${prevNnnn}_snapshot.json`), 'utf8'))
    assert.equal(snap.prevId, prev.id, `${folder}: snapshot must chain onto the previous one`)
    assert.notEqual(snap.id, prev.id)
    // Data-only: the schema body is unchanged.
    assert.deepEqual({ ...snap, id: 0, prevId: 0 }, { ...prev, id: 0, prevId: 0 })
  })

  test(`${folder}: applying the backfill marks every existing user verified`, () => {
    const sql = fs.readFileSync(path.join(migrationsDir(folder), backfillFile(folder)), 'utf8')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE `user` (`id` text PRIMARY KEY, `email` text, `emailVerified` integer DEFAULT false NOT NULL)')
    db.exec("INSERT INTO `user` VALUES ('a', 'a@example.com', 0), ('b', 'b@example.com', 0), ('c', 'c@example.com', 1)")
    for (const statement of sql.split('--> statement-breakpoint')) {
      if (statement.trim()) db.exec(statement)
    }
    const rows = db.prepare('SELECT `emailVerified` AS v FROM `user` ORDER BY `id`').all()
    assert.deepEqual(rows.map(r => r.v), [1, 1, 1])
    db.close()
  })
}
