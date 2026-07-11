// generate-migrations.ts — Drizzle migration generation WITHOUT a Nuxt process
// (#1445 WS2). The migration step resolves the app's schema graph directly
// (schema-sources.ts), gates it for duplicate tables (duplicate-tables.ts), then
// runs the app's own `db:generate` (drizzle-kit, resolved from the app dir, which
// reads the runtime-resolving drizzle.config.ts). The old build-first round trip
// (the NITRO_PRESET=node-server Nuxt-build → poll-for-bundle → kill dance) is
// gone — see the epic brief for why.

import { spawnSync } from 'node:child_process'
import consola from 'consola'

import { detectPackageManager } from './detect-package-manager.ts'
import { resolveSchemaGraph } from './schema-sources.ts'
import { findDuplicateTables } from './duplicate-tables.ts'

/** Two DISTINCT table definitions share a SQL name across the resolved set. */
export class DuplicateTableError extends Error {
  readonly table: string
  readonly files: string[]
  constructor(table: string, files: string[]) {
    super(`Duplicate table "${table}" defined in:\n  ${files.join('\n  ')}`)
    this.name = 'DuplicateTableError'
    this.table = table
    this.files = files
  }
}

export interface PreparedSchema {
  /** Resolved absolute schema-source paths. */
  paths: string[]
  /** Declared `extends` specs that could not be resolved to a layer dir. */
  unresolved: string[]
}

/**
 * The pre-drizzle phase: resolve the schema graph and run the duplicate-table
 * gate. Throws {@link DuplicateTableError} on a genuine clash; otherwise returns
 * the resolved paths plus any unresolved `extends` specs (the caller defers on
 * those).
 */
export async function prepareSchemaForMigration(appDir: string): Promise<PreparedSchema> {
  const { paths, unresolved } = resolveSchemaGraph(appDir)
  const duplicates = await findDuplicateTables(paths)
  if (duplicates.length > 0) {
    const d = duplicates[0]
    throw new DuplicateTableError(d.table, d.files)
  }
  return { paths, unresolved }
}

export type GenerateMigrationsResult
  = | { generated: true }
    | { generated: false, reason: 'deferred', recipe: string[] }
    | { generated: false, reason: 'generate-failed', detail?: string }

/**
 * Resolve the schema graph, gate it, then generate migrations via the app's own
 * `db:generate` (drizzle-kit, resolved from the app dir) — no Nuxt process.
 *
 * DEFERS (soft) when a declared `extends` can't be resolved (e.g. an app
 * scaffolded outside the monorepo with deps not yet installed) — returns a
 * recipe instead of shipping a wrong, incomplete migration. THROWS
 * {@link DuplicateTableError} (hard) on a real duplicate-table clash — the
 * caller exits non-zero.
 */
export async function generateMigrations(
  appDir: string = process.cwd()
): Promise<GenerateMigrationsResult> {
  const { unresolved } = await prepareSchemaForMigration(appDir)

  // Soft stop: a declared layer couldn't be resolved → generating now would
  // silently omit its tables. Defer with the recipe rather than ship a partial.
  if (unresolved.length > 0) {
    return { generated: false, reason: 'deferred', recipe: manualMigrationSteps(appDir) }
  }

  // Generate via the app's own db:generate — drizzle-kit reads the runtime-
  // resolving drizzle.config.ts and is resolved from the app dir (version-owned).
  consola.start('Generating migrations...')
  const pm = detectPackageManager(appDir)
  const [cmd, args] = runScriptCommand(pm, 'db:generate')
  const gen = spawnSync(cmd, args, { cwd: appDir, stdio: 'pipe', encoding: 'utf-8' })

  if (gen.status !== 0) {
    return {
      generated: false,
      reason: 'generate-failed',
      detail: (gen.stderr || gen.stdout || '').trim().split('\n').slice(-5).join('\n')
    }
  }

  consola.success('Generated migrations')
  return { generated: true }
}

function runScriptCommand(pm: 'pnpm' | 'yarn' | 'npm', script: string): [string, string[]] {
  // yarn runs scripts directly; pnpm/npm use `run`
  if (pm === 'yarn') return ['yarn', [script]]
  return [pm, ['run', script]]
}

/**
 * The exact manual sequence to run when generation was deferred (e.g. a fresh
 * scaffold whose deps aren't installed, so its layers can't be resolved yet).
 */
export function manualMigrationSteps(appDir?: string): string[] {
  const cd = appDir ? `cd ${appDir} && ` : ''
  return [
    `${cd}pnpm install`,
    'pnpm db:generate   # drizzle-kit writes server/db/migrations/** (resolves the schema — no Nuxt process)'
  ]
}
