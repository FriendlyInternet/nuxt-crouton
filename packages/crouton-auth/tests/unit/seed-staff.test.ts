/**
 * The auth seed creates the demo team and nothing else — no login, no password
 * (#2357, #2365, epic #2356). Logins come from the per-app review login the
 * deploy creates; a password in a seed would be public (this repo is public).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { provider } from '../../seed/index'

function fakeCtx() {
  const upserts: Array<{ table: string, key: Record<string, unknown>, values: Record<string, any> }> = []
  const raws: string[] = []
  const ctx = {
    teamId: 'seed:org:test1',
    teamSlug: 'test1',
    locale: 'nl',
    now: { sql: 'unixepoch()' },
    upsert: (table: string, key: Record<string, unknown>, values: Record<string, any>) => { upserts.push({ table, key, values }) },
    raw: (sql: string) => { raws.push(sql) }
  }
  return { ctx: ctx as any, upserts, raws }
}

describe('auth seed (#2357, #2365)', () => {
  it('seeds only the demo team: no user, account, member or session rows', async () => {
    const { ctx, upserts, raws } = fakeCtx()

    await provider.seed(ctx)

    expect(upserts.map(u => u.table)).toEqual(['organization'])
    expect(upserts[0]!.values.slug).toBe('test1')
    expect(raws).toHaveLength(0)
  })

  it('the seed code holds no password and no login email', () => {
    const src = readFileSync(resolve(__dirname, '../../seed/index.ts'), 'utf8')
    expect(src).not.toMatch(/password\s*[:=]/i)
    expect(src).not.toContain('hashPassword')
    expect(src).not.toMatch(/@[a-z0-9-]+\.[a-z]+/i)
  })
})
