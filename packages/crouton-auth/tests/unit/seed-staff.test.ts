/**
 * The seeded staff login (`crouton-seed --with-staff`) takes its password from a
 * secret, never from the code (#2357, epic #2356).
 *
 * Before: `claude-verify@test.local` was seeded as the team OWNER with a password
 * written in seed/index.ts — a public repo — so anyone could log into every staging
 * app that runs the seed. These cases are the contract for the fix.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyPassword } from 'better-auth/crypto'
import { provider } from '../../seed/index'

const ENV = 'CROUTON_SEED_STAFF_PASSWORD'
const STAFF_EMAIL = 'claude-verify@test.local'

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

const rowsFor = (upserts: ReturnType<typeof fakeCtx>['upserts'], table: string) =>
  upserts.filter(u => u.table === table)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('seeded staff login (#2357)', () => {
  it('secret set → creates the staff login with exactly that password (hashed, never stored plain)', async () => {
    vi.stubEnv(ENV, 'a-long-random-secret-value')
    const { ctx, upserts } = fakeCtx(true)

    await provider.seed(ctx)

    const [user] = rowsFor(upserts, 'user')
    expect(user?.values.email).toBe(STAFF_EMAIL)
    const [account] = rowsFor(upserts, 'account')
    expect(account?.values.providerId).toBe('credential')
    expect(account?.values.password).not.toBe('a-long-random-secret-value')
    expect(await verifyPassword({ hash: account!.values.password, password: 'a-long-random-secret-value' })).toBe(true)
    expect(rowsFor(upserts, 'member')).toHaveLength(1)
  })

  it('secret missing → no staff login is created, and a warning says why', async () => {
    vi.stubEnv(ENV, '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, upserts } = fakeCtx(true)

    await provider.seed(ctx)

    expect(rowsFor(upserts, 'user')).toHaveLength(0)
    expect(rowsFor(upserts, 'member')).toHaveLength(0)
    expect(rowsFor(upserts, 'account').filter(a => a.values.password)).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(ENV))
  })

  it('secret missing → an ALREADY-seeded staff account loses its old password (so the published one stops working)', async () => {
    vi.stubEnv(ENV, '')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, raws } = fakeCtx(true)

    await provider.seed(ctx)

    const clear = raws.find(sql => /update\s+["`]?account["`]?\s+set\s+["`]?password["`]?\s*=\s*null/i.test(sql))
    expect(clear, 'expected a statement nulling the staff account password').toBeTruthy()
  })

  it('a whitespace-only secret counts as missing', async () => {
    vi.stubEnv(ENV, '   ')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, upserts } = fakeCtx(true)

    await provider.seed(ctx)

    expect(rowsFor(upserts, 'user')).toHaveLength(0)
  })

  it('without --with-staff → no staff rows at all, whatever the secret', async () => {
    vi.stubEnv(ENV, 'a-long-random-secret-value')
    const { ctx, upserts, raws } = fakeCtx(false)

    await provider.seed(ctx)

    expect(rowsFor(upserts, 'user')).toHaveLength(0)
    expect(rowsFor(upserts, 'account')).toHaveLength(0)
    expect(raws).toHaveLength(0)
    // the team itself is still seeded
    expect(rowsFor(upserts, 'organization')).toHaveLength(1)
  })

  it('the old published password is gone from the seed code', () => {
    const src = readFileSync(resolve(__dirname, '../../seed/index.ts'), 'utf8')
    expect(src).not.toContain('VerifyCart2026')
  })
})
