// #3967 — locations now list the team products they offer (`products`) and bookings carry a
// `product`. Every bookings app's migration history therefore carries a data-only conversion
// that gives each existing location one `loc-<id>` product (stock = its old capacity) and links
// each existing booking to it. This test proves (1) every bookings folder has exactly one, with a
// chained data-only snapshot, and (2) the real SQL, run on a real sqlite DB, gives the exact
// values the ticket agreed and changes nothing when run a second time.
//
// Run: node --test scripts/products-per-location-migration.test.mjs
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

function conversionFile(folder) {
  const files = fs.readdirSync(migrationsDir(folder)).filter(f => f.endsWith('_products_per_location.sql'))
  assert.equal(files.length, 1, `${folder}: expected exactly one *_products_per_location.sql, found ${files.length}`)
  return files[0]
}

// covers: T1
test('the list covers every bookings app with a sqlite migration history', () => {
  const found = []
  for (const top of ['apps', 'pocs', 'fixtures']) {
    for (const name of fs.readdirSync(path.join(ROOT, top))) {
      const folder = `${top}/${name}`
      const pkgPath = path.join(ROOT, folder, 'package.json')
      if (!fs.existsSync(migrationsDir(folder)) || !fs.existsSync(pkgPath)) continue
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
      if (deps['@fyit/crouton-bookings']) found.push(folder)
    }
  }
  assert.deepEqual(found.sort(), [...FOLDERS].sort())
})

const DDL = [
  `CREATE TABLE catalog_products (
    id text PRIMARY KEY NOT NULL, teamId text NOT NULL, owner text NOT NULL, "order" integer NOT NULL,
    title text NOT NULL, description text, active integer, translations text,
    createdAt integer NOT NULL, updatedAt integer NOT NULL, createdBy text NOT NULL, updatedBy text NOT NULL)`,
  `CREATE TABLE bookings_locations (
    id text PRIMARY KEY NOT NULL, teamId text NOT NULL, owner text NOT NULL, title text NOT NULL,
    inventoryMode integer, quantity integer, slots text, translations text, products text,
    createdAt integer NOT NULL, updatedAt integer NOT NULL, createdBy text NOT NULL, updatedBy text NOT NULL)`,
  'CREATE TABLE bookings_bookings (id text PRIMARY KEY NOT NULL, location text NOT NULL, product text)'
]

function seed(db) {
  for (const s of DDL) db.exec(s)
  const ins = db.prepare(`INSERT INTO bookings_locations
    (id, teamId, owner, title, inventoryMode, quantity, slots, translations, products, createdAt, updatedAt, createdBy, updatedBy)
    VALUES (?, ?, 'u1', ?, ?, ?, ?, ?, ?, 100, 200, 'u1', 'u2')`)
  ins.run('A', 't1', 'Kayak Rental', 1, 8, null, JSON.stringify({ nl: { title: 'Kajakverhuur', city: 'Brugge' } }), null)
  ins.run('B', 't1', 'Court B', 0, null, JSON.stringify([{ id: 's1', label: 'Morning', capacity: 1 }, { id: 's2', label: 'Noon', capacity: 1 }, { id: 's3', label: 'Evening', capacity: 2 }]), null, null)
  ins.run('C', 't1', 'Room C', 0, null, JSON.stringify([{ id: 's1', label: 'Morning' }]), null, null)
  ins.run('D', 't1', 'Bikes D', 1, 0, null, null, null)
  ins.run('E', 't2', 'Terrein', 0, null, null, JSON.stringify({ en: { title: 'Court' }, nl: { title: 'Terrein' } }), null)
  ins.run('F', 't1', 'Already', 0, null, null, null, JSON.stringify([{ product: 'keep-me', stock: 3 }]))
  // NULL-as-JSON-text in translations and slots counts as empty
  ins.run('G', 't1', 'Gym', 0, null, 'null', 'null', null)
  db.exec("INSERT INTO bookings_bookings VALUES ('b1', 'A', NULL), ('b2', 'B', 'keep')")
}

function apply(db, sql) {
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim()) db.exec(statement)
  }
}

function snapshot(db) {
  const products = db.prepare('SELECT * FROM catalog_products ORDER BY id').all()
    .map(r => ({ ...r, translations: JSON.parse(r.translations) }))
  const locations = Object.fromEntries(db.prepare('SELECT id, products FROM bookings_locations ORDER BY id').all()
    .map(r => [r.id, JSON.parse(r.products)]))
  const bookings = Object.fromEntries(db.prepare('SELECT id, product FROM bookings_bookings ORDER BY id').all()
    .map(r => [r.id, r.product]))
  return { products, locations, bookings }
}

for (const folder of FOLDERS) {
  // covers: T1
  test(`${folder}: the conversion is in the journal, with a chained data-only snapshot`, () => {
    const file = conversionFile(folder)
    const dir = migrationsDir(folder)
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8'))
    const entry = journal.entries.find(e => e.tag === file.replace(/\.sql$/, ''))
    assert.ok(entry, `${folder}: conversion must be in the journal`)
    assert.ok(entry.idx > 0)

    const nnnn = String(entry.idx).padStart(4, '0')
    const prevNnnn = String(entry.idx - 1).padStart(4, '0')
    const snap = JSON.parse(fs.readFileSync(path.join(dir, `meta/${nnnn}_snapshot.json`), 'utf8'))
    const prev = JSON.parse(fs.readFileSync(path.join(dir, `meta/${prevNnnn}_snapshot.json`), 'utf8'))
    assert.equal(snap.prevId, prev.id, `${folder}: snapshot must chain onto the previous one`)
    assert.notEqual(snap.id, prev.id)
    assert.deepEqual({ ...snap, id: 0, prevId: 0 }, { ...prev, id: 0, prevId: 0 })
    // The previous migration is the one that added the two columns.
    assert.ok(prev.tables.bookings_locations.columns.products, `${folder}: bookings_locations.products must exist before the conversion`)
    assert.ok(prev.tables.bookings_bookings.columns.product, `${folder}: bookings_bookings.product must exist before the conversion`)
  })

  // covers: T1
  test(`${folder}: the conversion gives every existing location one product and links its bookings`, () => {
    const sql = fs.readFileSync(path.join(migrationsDir(folder), conversionFile(folder)), 'utf8')
    const db = new DatabaseSync(':memory:')
    seed(db)
    apply(db, sql)
    const first = snapshot(db)

    const byId = Object.fromEntries(first.products.map(p => [p.id, p]))
    assert.deepEqual(byId['loc-A'], {
      id: 'loc-A', teamId: 't1', owner: 'u1', order: 0, title: 'Kayak Rental', description: null, active: 1,
      translations: { nl: { title: 'Kajakverhuur' }, en: { title: 'Kayak Rental' } },
      createdAt: 100, updatedAt: 200, createdBy: 'u1', updatedBy: 'u2'
    })
    assert.deepEqual(byId['loc-E'].translations, { en: { title: 'Court' }, nl: { title: 'Terrein' } })
    assert.equal(byId['loc-E'].teamId, 't2')
    assert.deepEqual(byId['loc-G'].translations, { en: { title: 'Gym' } })
    assert.equal(byId['loc-F'], undefined, 'a location that already lists products gets no loc- product')
    assert.deepEqual(first.products.map(p => p.id), ['loc-A', 'loc-B', 'loc-C', 'loc-D', 'loc-E', 'loc-G'])

    assert.deepEqual(first.locations, {
      A: [{ product: 'loc-A', stock: 8 }],
      B: [{ product: 'loc-B', stock: 2 }],
      C: [{ product: 'loc-C', stock: 1 }],
      D: [{ product: 'loc-D', stock: 1 }],
      E: [{ product: 'loc-E', stock: 1 }],
      F: [{ product: 'keep-me', stock: 3 }],
      G: [{ product: 'loc-G', stock: 1 }]
    })
    assert.deepEqual(first.bookings, { b1: 'loc-A', b2: 'keep' })

    // Running it a second time changes nothing.
    apply(db, sql)
    assert.deepEqual(snapshot(db), first)
    db.close()
  })
}
