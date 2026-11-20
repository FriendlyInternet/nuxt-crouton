// #4182 (5b.2 of #3940) — since 5b.1 no code reads the location columns `inventoryMode` and
// `quantity`, or the `capacity` key inside a slot. Every bookings app therefore carries one
// migration that (1) empties `slots` on locations that were in inventory mode, (2) strips
// `capacity` from every stored slot, and (3) drops the two columns. This test proves, per folder:
//   M1(a) exactly one *_drop_inventory_mode.sql, journalled at the previous idx + 1;
//   M1(b) its snapshot chains onto the previous one and differs only by the two dropped columns;
//   M1(c) applied on top of the folder's OWN real migration history (not hand-written DDL), the
//         SQL gives the agreed values and leaves the booking's own `quantity` alone;
//   M2    the SQL is byte-identical in all five folders.
//
// Run: node --test scripts/drop-inventory-mode-migration.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Every app/POC/fixture that uses @fyit/crouton-bookings and has a sqlite migration history.
const FOLDERS = ['apps/velo', 'pocs/booking-demo', 'pocs/crouton-builder', 'pocs/gallery', 'fixtures/with-bookings']

const migrationsDir = folder => path.join(ROOT, folder, 'server/db/migrations/sqlite')
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function dropFile(folder) {
  const files = fs.readdirSync(migrationsDir(folder)).filter(f => f.endsWith('_drop_inventory_mode.sql'))
  assert.equal(files.length, 1, `${folder}: expected exactly one *_drop_inventory_mode.sql, found ${files.length}`)
  return files[0]
}

function journalOf(folder) {
  return readJson(path.join(migrationsDir(folder), 'meta/_journal.json'))
}

function dropEntry(folder) {
  const tag = dropFile(folder).replace(/\.sql$/, '')
  const journal = journalOf(folder)
  const entry = journal.entries.find(e => e.tag === tag)
  assert.ok(entry, `${folder}: ${tag} must be in the journal`)
  return { entry, journal }
}

function apply(db, sql) {
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) db.exec(statement)
  }
}

// Insert a row filling every NOT NULL column without a default, so the test survives columns a
// later migration adds; `values` override the filler.
function insert(db, table, values) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  const row = {}
  for (const c of cols) {
    if (c.notnull && c.dflt_value === null) row[c.name] = /int/i.test(c.type) ? 0 : 'x'
  }
  Object.assign(row, values)
  const names = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map(n => row[n]))
}

// covers: T3
test('the list covers every bookings app with a sqlite migration history', () => {
  const found = []
  for (const top of ['apps', 'pocs', 'fixtures']) {
    for (const name of fs.readdirSync(path.join(ROOT, top))) {
      const folder = `${top}/${name}`
      const pkgPath = path.join(ROOT, folder, 'package.json')
      if (!fs.existsSync(migrationsDir(folder)) || !fs.existsSync(pkgPath)) continue
      const pkg = readJson(pkgPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
      if (deps['@fyit/crouton-bookings']) found.push(folder)
    }
  }
  assert.deepEqual(found.sort(), [...FOLDERS].sort())
})

// covers: T3
test('M2: the migration SQL is identical in every bookings app', () => {
  const sqls = FOLDERS.map(folder => fs.readFileSync(path.join(migrationsDir(folder), dropFile(folder)), 'utf8'))
  for (let i = 1; i < sqls.length; i++) {
    assert.equal(sqls[i], sqls[0], `${FOLDERS[i]} differs from ${FOLDERS[0]}`)
  }
})

const SLOTS = [{ id: 'am', label: 'AM', capacity: 3 }, { id: 'pm', label: 'PM', capacity: 1 }]

for (const folder of FOLDERS) {
  // covers: T1
  test(`${folder}: M1(a)+(b) the migration is journalled next, with a snapshot minus the two columns`, () => {
    const { entry, journal } = dropEntry(folder)
    const prevEntry = journal.entries.find(e => e.idx === entry.idx - 1)
    assert.ok(prevEntry, `${folder}: there must be a migration before it`)
    assert.ok(dropFile(folder).startsWith(String(entry.idx).padStart(4, '0') + '_'))

    const dir = migrationsDir(folder)
    const snap = readJson(path.join(dir, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`))
    const prev = readJson(path.join(dir, `meta/${String(prevEntry.idx).padStart(4, '0')}_snapshot.json`))
    assert.equal(snap.prevId, prev.id, `${folder}: snapshot must chain onto the previous one`)
    assert.notEqual(snap.id, prev.id)

    const prevCols = prev.tables.bookings_locations.columns
    assert.ok(prevCols.inventoryMode && prevCols.quantity, `${folder}: the columns must exist before the migration`)
    const expected = structuredClone(prev)
    delete expected.tables.bookings_locations.columns.inventoryMode
    delete expected.tables.bookings_locations.columns.quantity
    // deepEqual, not a string compare: drizzle-kit may write keys in another order.
    assert.deepEqual({ ...snap, id: 0, prevId: 0 }, { ...expected, id: 0, prevId: 0 })
  })

  // covers: T2
  test(`${folder}: M1(c) on the folder's real history it empties inventory slots, strips capacity and drops the columns`, () => {
    const { entry, journal } = dropEntry(folder)
    const dir = migrationsDir(folder)
    const db = new DatabaseSync(':memory:')
    for (const e of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      if (e.idx >= entry.idx) continue
      apply(db, fs.readFileSync(path.join(dir, `${e.tag}.sql`), 'utf8'))
    }

    insert(db, 'bookings_locations', { id: 'A', title: 'A', inventoryMode: 1, quantity: 8, slots: JSON.stringify(SLOTS) })
    insert(db, 'bookings_locations', { id: 'B', title: 'B', inventoryMode: 0, slots: JSON.stringify(SLOTS) })
    insert(db, 'bookings_locations', { id: 'C', title: 'C', slots: 'not json' })
    insert(db, 'bookings_locations', { id: 'D', title: 'D', slots: JSON.stringify([{ id: 'x', capacity: 2 }, 'odd']) })
    insert(db, 'bookings_bookings', { id: 'b1', location: 'B', quantity: 2 })

    apply(db, fs.readFileSync(path.join(dir, dropFile(folder)), 'utf8'))

    const slots = Object.fromEntries(db.prepare('SELECT id, slots FROM bookings_locations ORDER BY id').all()
      .map(r => [r.id, r.slots]))
    assert.deepEqual(JSON.parse(slots.A), [])
    assert.deepEqual(JSON.parse(slots.B), [{ id: 'am', label: 'AM' }, { id: 'pm', label: 'PM' }])
    assert.equal(slots.C, 'not json')
    assert.deepEqual(JSON.parse(slots.D), [{ id: 'x' }, 'odd'])

    const cols = db.prepare('PRAGMA table_info(bookings_locations)').all().map(c => c.name)
    assert.ok(!cols.includes('inventoryMode'), `${folder}: inventoryMode must be dropped`)
    assert.ok(!cols.includes('quantity'), `${folder}: quantity must be dropped`)
    assert.equal(db.prepare("SELECT quantity FROM bookings_bookings WHERE id = 'b1'").get().quantity, 2)
    db.close()
  })
}
