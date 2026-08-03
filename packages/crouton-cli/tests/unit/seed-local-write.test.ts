import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { runLocalSeed } from '../../lib/seed-app'

// #1612 (behavioural proof) — the local runner must write into `<appDir>/.data/db/sqlite.db`
// (the file nuxt dev reads) and never touch the miniflare `.wrangler` dir.
// Local-only: CI lacks the better-sqlite3 native binding (same reason as crouton-printing #1539).
describe.skipIf(process.env.CI)('local seed writes into .data/db/sqlite.db (#1612)', () => {
  it('a row from the local runner lands in the .data DB, and .wrangler is never touched', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'seed-write-'))
    try {
      mkdirSync(join(appDir, '.data', 'db'), { recursive: true })
      const path = join(appDir, '.data', 'db', 'sqlite.db')
      // nuxt dev has already created + migrated .data at boot — simulate an existing table.
      const setup = new Database(path)
      setup.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
      setup.close()

      runLocalSeed(appDir, "INSERT INTO t (id) VALUES ('x')")

      const db = new Database(path, { readonly: true })
      expect(db.prepare('SELECT count(*) AS c FROM t').get()).toMatchObject({ c: 1 })
      db.close()
      // The whole point: the miniflare DB is never written.
      expect(existsSync(join(appDir, '.wrangler'))).toBe(false)
    }
    finally {
      rmSync(appDir, { recursive: true, force: true })
    }
  })
})
