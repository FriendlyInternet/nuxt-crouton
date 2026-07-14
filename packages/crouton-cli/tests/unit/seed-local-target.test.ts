import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { localDbPath, seedLocalChunks } from '../../lib/seed-app'

// #1612 — a local `crouton-seed` used to shell to `wrangler d1 execute --local`, which writes the
// miniflare DB (`.wrangler/state/v3/d1/…`). But `nuxt dev` (`hub: { db: 'sqlite' }`) reads a
// DIFFERENT file via the libsql driver: `.data/db/sqlite.db`. So locally-seeded rows never showed
// up in the running dev app. The fix executes the seed SQL straight against the file dev reads.

describe('local seed targets the DB nuxt dev reads (#1612)', () => {
  it('localDbPath points at .data/db/sqlite.db, not the miniflare .wrangler dir', () => {
    const p = localDbPath('/some/app')
    expect(p).toBe(join('/some/app', '.data', 'db', 'sqlite.db'))
    expect(p).not.toContain('.wrangler')
  })
})

describe('seedLocalChunks (#1612)', () => {
  let appDir: string

  beforeEach(() => {
    appDir = mkdtempSync(join(tmpdir(), 'crouton-seed-local-'))
  })
  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true })
  })

  async function initDevDb() {
    mkdirSync(join(appDir, '.data', 'db'), { recursive: true })
    const c = createClient({ url: `file:${localDbPath(appDir)}` })
    await c.executeMultiple('CREATE TABLE foo (id TEXT PRIMARY KEY, name TEXT);')
    c.close()
  }

  async function rowsInDevDb() {
    const c = createClient({ url: `file:${localDbPath(appDir)}` })
    const res = await c.execute('SELECT id, name FROM foo ORDER BY id')
    c.close()
    return res.rows
  }

  it('writes the seed rows into .data/db/sqlite.db (never the .wrangler miniflare dir)', async () => {
    await initDevDb()

    const { ok, skipped } = await seedLocalChunks(appDir, [
      { label: 'provider:demo', sql: "INSERT INTO foo (id, name) VALUES ('1', 'hi');" },
    ])

    expect(ok).toBe(1)
    expect(skipped).toEqual([])
    expect(await rowsInDevDb()).toEqual([{ id: '1', name: 'hi' }])
    // The whole point of #1612: the seed must NOT go to the miniflare DB.
    expect(existsSync(join(appDir, '.wrangler'))).toBe(false)
  })

  it('missing .data/db/sqlite.db → actionable "run dev + migrate first" error, no .wrangler write', async () => {
    await expect(
      seedLocalChunks(appDir, [{ label: 'provider:demo', sql: "INSERT INTO foo (id, name) VALUES ('1', 'hi');" }]),
    ).rejects.toThrow(/dev|migrat/i)
    expect(existsSync(join(appDir, '.wrangler'))).toBe(false)
  })

  it('a chunk hitting a missing table warns + skips; the other chunks still land', async () => {
    await initDevDb()

    const { ok, skipped } = await seedLocalChunks(appDir, [
      { label: 'provider:demo', sql: "INSERT INTO foo (id, name) VALUES ('1', 'a');" },
      { label: 'provider:bookings', sql: "INSERT INTO bookings_settings (id) VALUES ('x');" },
      { label: 'collection-fixtures', sql: "INSERT INTO foo (id, name) VALUES ('2', 'b');" },
    ])

    expect(ok).toBe(2)
    expect(skipped).toEqual(['provider:bookings'])
    expect(await rowsInDevDb()).toEqual([{ id: '1', name: 'a' }, { id: '2', name: 'b' }])
  })
})
