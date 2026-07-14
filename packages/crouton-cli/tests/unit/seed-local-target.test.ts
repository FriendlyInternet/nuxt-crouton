import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSeedTarget, assertLocalSeedReady } from '../../lib/seed-app'

// #1612 — a local `crouton-seed` used to write the miniflare `.wrangler` DB, but `nuxt dev`
// (hub: { db: 'sqlite' }) reads `.data/db/sqlite.db`, so seeded data never showed up. Local seeds
// must land in the DB dev actually reads; remote is untouched.
describe('resolveSeedTarget — local seeds go where nuxt dev reads (#1612)', () => {
  it('local (default) → the app .data sqlite file, not wrangler/miniflare', () => {
    expect(resolveSeedTarget({ db: 'fanfare-db', remote: false, appDir: '/app' }))
      .toMatchObject({ kind: 'sqlite', path: join('/app', '.data', 'db', 'sqlite.db') })
  })

  it('remote → untouched, still wrangler --remote', () => {
    expect(resolveSeedTarget({ db: 'fanfare-db', remote: true, appDir: '/app' }))
      .toMatchObject({ kind: 'wrangler', db: 'fanfare-db', remote: true })
  })
})

describe('assertLocalSeedReady — a missing local DB fails with a recipe (#1612)', () => {
  it('no .data/db/sqlite.db yet → throws the run-`pnpm dev`-first recipe', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'seed-target-')) // empty: no .data
    try {
      expect(() => assertLocalSeedReady(appDir)).toThrow(/pnpm dev/i)
    }
    finally {
      rmSync(appDir, { recursive: true, force: true })
    }
  })
})
