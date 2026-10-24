/**
 * The seed no longer creates a staff login at all (#2357, epic #2356).
 *
 * Before: `claude-verify@test.local` was seeded (with `--with-staff`) as the team
 * OWNER, with a password written in seed/index.ts — a public repo — so anyone could
 * log into every staging app that ran the seed. The per-app review login (created by
 * the deploy itself, password from a secret) covers the same need for every app, so
 * the staff login is removed instead of moved to a secret.
 *
 * These cases are the contract for that removal.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { provider } from '../../seed/index'

const LEGACY_EMAIL = 'claude-verify@test.local'

/** A fake SeedContext that records what the provider asked for. */
function fakeCtx(withStaff: boolean) {
  const upserts: Array<{ table: string, key: Record<string, unknown>, values: Record<string, any> }> = []
  const raws: string[] = []
  const ctx = {
    teamId: 'seed:org:test1',
    teamSlug: 'test1',
    locale: 'nl',
    withStaff,
    now: { sql: 'unixepoch()' },
    upsert: (table: string, key: Record<string, unknown>, values: Record<string, any>) => { upserts.push({ table, key, values }) },
    raw: (sql: string) => { raws.push(sql) }
  }
  return { ctx: ctx as any, upserts, raws }
}

const tables = (upserts: ReturnType<typeof fakeCtx>['upserts']) => upserts.map(u => u.table)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('no staff login is seeded (#2357)', () => {
  for (const withStaff of [true, false]) {
    it(`withStaff=${withStaff} → only the team is seeded: no user, account or member rows`, async () => {
      vi.stubEnv('CROUTON_SEED_STAFF_PASSWORD', 'even-if-a-secret-is-set')
      const { ctx, upserts } = fakeCtx(withStaff)

      await provider.seed(ctx)

      expect(tables(upserts)).toEqual(['organization'])
    })
  }

  it('every seed clears the old staff account\'s password, so the published one stops working', async () => {
    const { ctx, raws } = fakeCtx(false)

    await provider.seed(ctx)

    const clear = raws.find(sql => /update\s+["`]?account["`]?\s+set\s+["`]?password["`]?\s*=\s*null/i.test(sql))
    expect(clear, 'expected a statement nulling the old staff account password').toBeTruthy()
  })

  it('every seed signs the old staff account out of any open session', async () => {
    const { ctx, raws } = fakeCtx(false)

    await provider.seed(ctx)

    const signOut = raws.find(sql => /delete\s+from\s+["`]?session["`]?/i.test(sql))
    expect(signOut, 'expected a statement deleting the old staff account\'s sessions').toBeTruthy()
  })

  it('the seed code holds no password and no staff email', () => {
    const src = readFileSync(resolve(__dirname, '../../seed/index.ts'), 'utf8')
    expect(src).not.toContain('VerifyCart2026')
    expect(src).not.toContain('hashPassword')
    // the legacy email may appear only to identify the account being disabled
    expect(src.split(LEGACY_EMAIL).length - 1).toBeLessThanOrEqual(1)
  })
})
