// Tests for pr-preview-migrate.mjs (#4004) — run: node --test scripts/lib/pr-preview-migrate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { decide, sortMigrationNames, guardDbName, migrate } from './pr-preview-migrate.mjs'
import { dropTablesSql, isUserTable, LIST_TABLES_SQL, orderForDrop } from './wrangler-d1.mjs'

const cfg = (name, extra = {}) => ({ d1_databases: [{ binding: 'DB', database_name: name, migrations_dir: '/abs/migrations', ...extra }] })

/** Stand-in I/O recording every call; `tables` answers sqlite_master, `recorded` answers d1_migrations. */
function standIns({ recorded = null, files = [], tables = [], applyStatus = 0 } = {}) {
  const calls = []
  return {
    calls,
    io: {
      listFiles: async (dir) => { calls.push(['listFiles', dir]); return files },
      query: async (name, sql) => {
        calls.push(['query', name, sql])
        if (sql.includes("name='d1_migrations'")) return recorded === null ? [] : [{ name: 'd1_migrations' }]
        if (sql.includes('FROM "d1_migrations"')) return (recorded ?? []).map(name => ({ name }))
        if (sql === LIST_TABLES_SQL) return tables.map(name => ({ name }))
        if (sql.includes('pragma_foreign_key_list')) return []
        throw new Error(`unexpected sql: ${sql}`)
      },
      exec: async (name, sql) => { calls.push(['exec', name, sql]) },
      apply: async (name) => { calls.push(['apply', name]); return applyStatus }
    }
  }
}

test('sortMigrationNames orders by leading number, then by string', () => {
  assert.deepEqual(sortMigrationNames(['0010_a.sql', '0002_b.sql', '0002_a.sql', 'x.sql']), ['0002_a.sql', '0002_b.sql', '0010_a.sql', 'x.sql'])
})

test('T1 — nothing recorded, or recorded equal to the first N sorted files, gives apply and no drop', async () => {
  const files = ['0001_a.sql', '0000_init.sql', '0002_b.sql']
  assert.deepEqual(decide({ recorded: [], files }), { action: 'apply' })
  assert.deepEqual(decide({ recorded: ['0000_init.sql', '0001_a.sql'], files }), { action: 'apply' })
  assert.deepEqual(decide({ recorded: ['0000_init.sql', '0001_a.sql', '0002_b.sql'], files }), { action: 'apply' })

  for (const recorded of [null, ['0000_init.sql']]) {
    const { calls, io } = standIns({ recorded, files, tables: ['users'] })
    const code = await migrate({ app: 'velo', pr: '12', config: cfg('velo-pr12-db'), ...io, log: () => {} })
    assert.equal(code, 0)
    assert.equal(calls.filter(c => c[0] === 'exec').length, 0)
    assert.equal(calls.filter(c => c[0] === 'apply').length, 1)
  }
})

test('T2 — the #3975 renumber gives rebuild with a warning naming 0007_brave_gorgon.sql', async () => {
  const recorded = ['0007_brave_gorgon.sql', '0008_massive_mister_sinister.sql']
  const files = ['0007_omniscient_ares.sql', '0008_brave_gorgon.sql', '0009_massive_mister_sinister.sql']
  assert.deepEqual(decide({ recorded, files }), { action: 'rebuild', mismatch: '0007_brave_gorgon.sql' })
  // a recorded name past the end of files is a mismatch too
  assert.deepEqual(decide({ recorded: ['0000_a.sql', '0001_gone.sql'], files: ['0000_a.sql'] }), { action: 'rebuild', mismatch: '0001_gone.sql' })

  const logs = []
  const { calls, io } = standIns({ recorded, files, tables: ['catalog_products', 'd1_migrations', '_cf_KV'] })
  const code = await migrate({ app: 'velo', pr: '3975', config: cfg('velo-pr3975-db'), ...io, log: m => logs.push(m) })
  assert.equal(code, 0)
  assert.ok(logs.some(l => l.startsWith('::warning::') && l.includes('0007_brave_gorgon.sql') && l.includes('velo-pr3975-db')))
  const execs = calls.filter(c => c[0] === 'exec')
  assert.equal(execs.length, 1)
  assert.equal(execs[0][2], dropTablesSql(['catalog_products', 'd1_migrations']))
  assert.deepEqual(calls.at(-1), ['apply', 'velo-pr3975-db'], 'apply runs after the drop')
})

test('T3 — on a real sqlite file with foreign keys on, the drop empties every user table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-preview-migrate-'))
  try {
    const db = new DatabaseSync(join(dir, 'd1.sqlite'))
    db.exec('PRAGMA foreign_keys = ON;')
    db.exec('CREATE TABLE zparent (id INTEGER PRIMARY KEY);')
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES zparent(id));')
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT);')
    db.exec('CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);')
    db.exec("INSERT INTO zparent (id) VALUES (1); INSERT INTO child (id, parent_id) VALUES (1, 1);")
    db.exec("INSERT INTO d1_migrations (name) VALUES ('0007_brave_gorgon.sql');")

    const logs = []
    const real = {
      listFiles: async () => ['0007_omniscient_ares.sql', '0008_brave_gorgon.sql'],
      query: async (_name, sql) => db.prepare(sql).all(),
      // D1 runs a --file as one batch — mirror that with a transaction.
      exec: async (_name, sql) => db.exec(`BEGIN;\n${sql}COMMIT;`),
      apply: async () => 0
    }
    const code = await migrate({ app: 'velo', pr: '12', config: cfg('velo-pr12-db'), ...real, log: m => logs.push(m) })
    assert.equal(code, 0)
    assert.ok(logs.includes('dropped 3 table(s) — preview database rebuilt'), logs.join('\n'))
    const left = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    assert.deepEqual(left.filter(isUserTable), [])
    assert.ok(left.includes('_cf_KV'))
    assert.ok(left.includes('sqlite_sequence'))
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('orderForDrop puts children before the parents they reference', () => {
  assert.deepEqual(orderForDrop(['session', 'user', 'org'], [{ child: 'session', parent: 'user' }, { child: 'user', parent: 'org' }]), ['session', 'user', 'org'])
  assert.deepEqual(orderForDrop(['user', 'session'], [{ child: 'session', parent: 'user' }]), ['session', 'user'])
})

test('T4 — the guard refuses any database but this PR\'s preview, before any I/O', async () => {
  for (const [app, name] of [['velo', 'velo-db'], ['velo', 'velo-staging-db'], ['velo', 'velo-pr13-db'], ['velo', 'kassa-pr12-db'], ['kassa', 'velo-pr12-db']]) {
    assert.equal(guardDbName(cfg(name), app, '12').ok, false, name)
    const logs = []
    const { calls, io } = standIns({ recorded: ['x.sql'], files: ['y.sql'], tables: ['users'] })
    const code = await migrate({ app, pr: '12', config: cfg(name), ...io, log: m => logs.push(m) })
    assert.equal(code, 1, name)
    assert.equal(calls.length, 0, `${name}: no stand-in calls`)
    assert.ok(logs[0].startsWith('::error::'))
  }
  assert.equal(guardDbName({}, 'velo', '12').ok, false)
  assert.deepEqual(guardDbName(cfg('velo-pr12-db'), 'velo', '12'), { ok: true, name: 'velo-pr12-db', reason: null })
})

test('T5 — when recorded is a prefix, migrate returns apply\'s status and never drops', async () => {
  const { calls, io } = standIns({ recorded: ['0000_init.sql'], files: ['0000_init.sql', '0001_a.sql'], tables: ['users'], applyStatus: 7 })
  const code = await migrate({ app: 'velo', pr: '12', config: cfg('velo-pr12-db'), ...io, log: () => {} })
  assert.equal(code, 7)
  assert.equal(calls.filter(c => c[0] === 'exec').length, 0)
})
