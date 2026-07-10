/**
 * The provider-agnostic core of the seed runner: dependency ordering and SQL
 * collection. The CLI command wraps this with discovery (which packages ship a
 * provider) and transport (piping the SQL to `wrangler d1 execute`).
 */
import type { SeedContext, SeedProvider, CreatePageWithBlocksFn } from './types'
import { buildUpsert } from './sql'
import { raw } from './sql'

/**
 * Topologically sort providers so a provider always runs after the providers
 * it `dependsOn`. Missing dependencies are skipped (the depended-on package
 * may simply not be part of this app). Throws on a dependency cycle.
 */
export function topoSort(providers: SeedProvider[]): SeedProvider[] {
  const byId = new Map(providers.map(p => [p.id, p]))
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const ordered: SeedProvider[] = []

  function visit(provider: SeedProvider) {
    if (visited.has(provider.id)) return
    if (onStack.has(provider.id)) {
      throw new Error(`Seed providers have a circular dependency at "${provider.id}"`)
    }
    onStack.add(provider.id)
    for (const dep of provider.dependsOn ?? []) {
      const depProvider = byId.get(dep)
      if (depProvider) visit(depProvider)
    }
    onStack.delete(provider.id)
    visited.add(provider.id)
    ordered.push(provider)
  }

  for (const provider of providers) visit(provider)
  return ordered
}

export interface CollectSeedSqlOptions {
  providers: SeedProvider[]
  teamSlug: string
  teamId: string
  locale: string
  withStaff?: boolean
  /**
   * Bound to `ctx.createPageWithBlocks` when crouton-pages is present. Receives
   * the live `ctx` so it can push its own upserts onto the same statement list.
   */
  createPageWithBlocks?: (ctx: SeedContext, options: Parameters<CreatePageWithBlocksFn>[0]) => string
}

/**
 * Run every provider (in dependency order) against a shared context and return
 * the combined, idempotent SQL. `createdAt` is held immutable on every upsert
 * so re-runs preserve the original insert time.
 */
export async function collectSeedSql(options: CollectSeedSqlOptions): Promise<string> {
  const statements: string[] = []

  const ctx: SeedContext = {
    teamId: options.teamId,
    teamSlug: options.teamSlug,
    locale: options.locale,
    withStaff: Boolean(options.withStaff),
    now: raw('unixepoch()'),
    upsert(table, byId, values) {
      statements.push(buildUpsert(table, byId, values ?? {}, { immutable: ['createdAt'] }))
    },
    raw(sql) {
      const trimmed = sql.trim()
      statements.push(trimmed.endsWith(';') ? trimmed : `${trimmed};`)
    }
  }

  if (options.createPageWithBlocks) {
    const create = options.createPageWithBlocks
    ctx.createPageWithBlocks = pageOptions => create(ctx, pageOptions)
  }

  for (const provider of topoSort(options.providers)) {
    await provider.seed(ctx)
  }

  return statements.join('\n')
}

/**
 * Executes one collected seed statement. Callers bind their live db here —
 * typically `stmt => db.run(sql.raw(stmt))` with drizzle's `sql` — because
 * shared/seed stays dependency-free (crouton-core does not declare drizzle-orm,
 * and an internal drizzle import would be an undeclared dependency).
 */
export type SeedSqlExecute = (statement: string) => Promise<unknown>

export interface RunSeedSqlOptions extends CollectSeedSqlOptions {}

/**
 * The dev-only executor half of the runner (#797): collect the providers' SQL
 * and run it, statement by statement, against the LIVE connection of a booted
 * app — the NuxtHub db the app actually reads — instead of the wrangler-D1
 * store the `crouton-seed` CLI writes (a DIFFERENT database in local dev).
 *
 * Statements run strictly sequentially in provider dependency order, so a row
 * always exists before anything that references it. A failing statement rejects
 * immediately and skips the rest — safe because the collected SQL is idempotent
 * upserts: re-running after a fix converges instead of duplicating.
 *
 * Guarded against production: bundlers define `import.meta.dev` as `false` in a
 * real build. Contexts where it's undefined (vitest, tsx) pass — they are by
 * definition not production bundles.
 */
export async function runSeedSql(
  execute: SeedSqlExecute,
  options: RunSeedSqlOptions
): Promise<{ statements: number }> {
  if ((import.meta as { dev?: boolean }).dev === false) {
    throw new Error('runSeedSql is a dev/test-only helper and must not run in a production build')
  }

  const seedSql = await collectSeedSql(options)
  // One upsert per line (JSON payloads are single-line by contract), so
  // splitting on newlines yields one statement per row.
  const statements = seedSql
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  for (const statement of statements) {
    await execute(statement)
  }

  return { statements: statements.length }
}
