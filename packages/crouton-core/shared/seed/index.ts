/**
 * Composable, per-package database seeding.
 *
 * Each package ships a {@link SeedProvider} from its `./seed` entry; an app's
 * seed runner discovers them, orders them by `dependsOn`, and turns their
 * declarative `ctx.upsert(...)` calls into idempotent SQL executed via
 * `wrangler d1` (local or remote). See ./runner.ts for the ordering/collection
 * core and ./sql.ts for the upsert builder.
 */
export type {
  SeedProvider,
  SeedContext,
  UpsertFn,
  PageBlock,
  CreatePageWithBlocksFn,
  CreatePageWithBlocksOptions
} from './types'

export { buildUpsert, sqlValue, raw, SqlRaw } from './sql'
export type { UpsertOptions } from './sql'
export { seedId, seedOrgId } from './id'
export { topoSort, collectSeedSql, runSeedSql } from './runner'
export type { CollectSeedSqlOptions, RunSeedSqlOptions, SeedSqlExecute } from './runner'
