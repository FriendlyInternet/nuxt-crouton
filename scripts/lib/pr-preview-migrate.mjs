/**
 * pr-preview-migrate.mjs — migrate a per-PR preview database that is KEPT between deploys (#4004).
 *
 * wrangler decides which migrations still need to run by FILE NAME only. A per-PR preview DB
 * outlives deploys (#2608), so when main gains a migration and drizzle-kit renumbers the PR's
 * own (`0007_brave_gorgon` → `0008_brave_gorgon`), the renamed file looks new and its
 * `CREATE TABLE` runs a second time: "table … already exists". The rule here: if the names the
 * database recorded are not a prefix of the sorted migration files, the database no longer
 * matches the code — empty it and apply from scratch (the seed steps refill it). Otherwise
 * apply normally. Nothing retries, and an apply failure never leads to a drop.
 *
 * Pure decision + `migrate` with injected I/O; the CLI (scripts/pr-preview-migrate.mjs) wires
 * the real wrangler calls.
 */
import { previewDbName } from './pr-preview-wrangler.mjs'
import { LIST_TABLES_SQL, LIST_FKS_SQL, dropTablesSql, isUserTable, orderForDrop } from './wrangler-d1.mjs'

/** Leading integer of a migration name, or null. */
function leadingNumber(name) {
  const m = /^(\d+)/.exec(String(name))
  return m ? Number(m[1]) : null
}

/** Sort like wrangler's compareMigrationPaths: by leading number when both have one, else by string. */
export function sortMigrationNames(names) {
  return [...names].sort((a, b) => {
    const na = leadingNumber(a)
    const nb = leadingNumber(b)
    if (na !== null && nb !== null && na !== nb) return na - nb
    if (a === b) return 0
    return a < b ? -1 : 1
  })
}

/** `apply` when recorded is a prefix of the sorted files; otherwise `rebuild` naming the first mismatch. */
export function decide({ recorded, files }) {
  const sorted = sortMigrationNames(files)
  for (let i = 0; i < recorded.length; i++) {
    if (recorded[i] !== sorted[i]) return { action: 'rebuild', mismatch: recorded[i] }
  }
  return { action: 'apply' }
}

/** Refuse anything but this PR's own preview database (exact name match). */
export function guardDbName(config, app, pr) {
  const name = config?.d1_databases?.[0]?.database_name
  const expected = previewDbName(app, pr)
  if (name === expected) return { ok: true, name, reason: null }
  return { ok: false, name, reason: `database "${name ?? '(none)'}" is not this PR's preview database "${expected}"` }
}

/**
 * Migrate the preview DB. Injected I/O:
 *   listFiles(dir) → string[]   query(name, sql) → rows[]   exec(name, sql) → void   apply(name) → exit status
 * Returns an exit code.
 */
export async function migrate({ app, pr, config, listFiles, query, exec, apply, log = console.log }) {
  const guard = guardDbName(config, app, pr)
  if (!guard.ok) {
    log(`::error::pr-preview-migrate refused: ${guard.reason}`)
    return 1
  }
  const { name } = guard
  const db = config.d1_databases[0]
  const table = db.migrations_table || 'd1_migrations'

  const exists = await query(name, `SELECT name FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}'`)
  const recorded = exists.length
    ? (await query(name, `SELECT name FROM "${table.replace(/"/g, '""')}" ORDER BY id`)).map(r => r.name)
    : []
  const files = db.migrations_dir ? (await listFiles(db.migrations_dir)) : []

  const decision = decide({ recorded, files })
  if (decision.action === 'rebuild') {
    log(`::warning::preview database ${name}: recorded migration ${decision.mismatch} no longer matches the migration files — emptying it`)
    const tables = (await query(name, LIST_TABLES_SQL)).map(r => r.name).filter(isUserTable)
    if (tables.length) await exec(name, dropTablesSql(orderForDrop(tables, await query(name, LIST_FKS_SQL))))
    log(`dropped ${tables.length} table(s) — preview database rebuilt`)
  }
  return await apply(name)
}
