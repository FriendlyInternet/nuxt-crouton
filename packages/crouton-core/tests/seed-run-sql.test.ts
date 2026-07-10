/**
 * runSeedSql (#797) — the dev-only executor half of the seed runner.
 *
 * `collectSeedSql` builds the idempotent SQL; `runSeedSql` executes it against
 * the LIVE db a booted app reads (NuxtHub `.data/db/sqlite.db`), instead of the
 * wrangler-D1 store the CLI writes. The db call itself is injected as an
 * `execute(statement)` callback because shared/seed is deliberately
 * dependency-free (crouton-core does not declare drizzle-orm) — the caller
 * supplies `stmt => db.run(sql.raw(stmt))`.
 *
 * The `import.meta.dev === false` production guard is implemented but not
 * unit-testable here: import.meta.dev is an esbuild-defined constant inside the
 * module under test and cannot be stubbed from a vitest spec. In vitest it is
 * `undefined`, which the guard deliberately lets through (dev/test contexts).
 */
import { describe, it, expect, vi } from 'vitest'
import { runSeedSql, collectSeedSql } from '../shared/seed'
import type { SeedProvider } from '../shared/seed'

/** Two tiny providers mirroring the real auth←sales dependency shape. */
function makeProviders(): SeedProvider[] {
  const auth: SeedProvider = {
    id: 'auth',
    seed(ctx) {
      ctx.upsert('organization', { id: `seed:org:${ctx.teamSlug}` }, { slug: ctx.teamSlug, name: 'Team' })
    }
  }
  const sales: SeedProvider = {
    id: 'sales',
    dependsOn: ['auth'],
    seed(ctx) {
      ctx.upsert('sales_events', { id: 'seed:event:kermis' }, { teamId: ctx.teamId, slug: 'kermis', title: 'Kermis' })
      ctx.upsert('sales_products', { id: 'seed:prod:cola' }, { teamId: ctx.teamId, title: 'Cola', price: 2 })
    }
  }
  // Deliberately listed dependent-first: topoSort must reorder.
  return [sales, auth]
}

const OPTIONS = { teamId: 'team-1', teamSlug: 'test1', locale: 'nl' }

describe('runSeedSql', () => {
  it('executes one statement per collected SQL line, in dependency order', async () => {
    const providers = makeProviders()
    const executed: string[] = []
    const execute = vi.fn(async (stmt: string) => { executed.push(stmt) })

    await runSeedSql(execute, { providers, ...OPTIONS })

    // Same statements collectSeedSql would emit, one execute() per line.
    const expected = (await collectSeedSql({ providers: makeProviders(), ...OPTIONS }))
      .split('\n').map(s => s.trim()).filter(s => s.length > 0)
    expect(executed).toEqual(expected)

    // Dependency order: auth's organization row lands before any sales row,
    // even though the sales provider was listed first.
    expect(executed[0]).toContain('"organization"')
    expect(executed.slice(1).every(s => s.includes('"sales_'))).toBe(true)
  })

  it('runs statements strictly sequentially (a row exists before its dependents run)', async () => {
    let active = 0
    let maxActive = 0
    const execute = async (_stmt: string) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(r => setTimeout(r, 1))
      active--
    }

    await runSeedSql(execute, { providers: makeProviders(), ...OPTIONS })
    expect(maxActive).toBe(1)
  })

  it('returns the number of executed statements', async () => {
    const result = await runSeedSql(async () => {}, { providers: makeProviders(), ...OPTIONS })
    expect(result).toEqual({ statements: 3 })
  })

  it('executes nothing and reports zero for an empty provider list', async () => {
    const execute = vi.fn(async () => {})
    const result = await runSeedSql(execute, { providers: [], ...OPTIONS })
    expect(execute).not.toHaveBeenCalled()
    expect(result).toEqual({ statements: 0 })
  })

  it('rejects on the failing statement and does not execute the rest', async () => {
    const executed: string[] = []
    const execute = async (stmt: string) => {
      if (executed.length === 1) throw new Error('no such table: sales_events')
      executed.push(stmt)
    }

    await expect(runSeedSql(execute, { providers: makeProviders(), ...OPTIONS }))
      .rejects.toThrow('no such table')
    // Only the statement before the failure ran; nothing after.
    expect(executed).toHaveLength(1)
  })
})
