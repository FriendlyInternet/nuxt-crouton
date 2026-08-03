/**
 * SQL builders for the seed runner.
 *
 * Seeding generates plain SQL that is executed via `wrangler d1 execute`
 * (local or remote) — the same transport the migration scripts use. No live
 * DB connection is needed, so the same code path works identically against a
 * local SQLite file and a remote Cloudflare D1.
 *
 * Idempotency comes from `INSERT … ON CONFLICT(<id>) DO UPDATE SET …` keyed on
 * stable, namespace-derived ids (see ./id.ts): a re-run upserts in place and
 * never inserts a duplicate.
 */

/** A raw SQL expression that should be inlined verbatim (not quoted). */
export class SqlRaw {
  constructor(public readonly sql: string) {}
}

/** Marks a string as a raw SQL expression, e.g. `raw('unixepoch()')`. */
export function raw(sql: string): SqlRaw {
  return new SqlRaw(sql)
}

/** Double-quote an identifier so reserved words like `order` are safe. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Single-quote a string literal, escaping embedded quotes. */
function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Render a JS value as a SQL literal.
 * - `null`/`undefined` → NULL
 * - boolean → 1/0 (SQLite has no native boolean)
 * - Date → unix seconds (matches Drizzle `mode: 'timestamp'`)
 * - object/array → JSON string
 * - SqlRaw → inlined verbatim
 */
export function sqlValue(value: unknown): string {
  if (value instanceof SqlRaw) return value.sql
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000))
  if (typeof value === 'object') return quoteString(JSON.stringify(value))
  return quoteString(String(value))
}

export interface UpsertOptions {
  /** Columns never overwritten on conflict (e.g. `createdAt`). */
  immutable?: string[]
  /**
   * Insert-if-absent: emit `ON CONFLICT DO NOTHING` regardless of updatable
   * columns, so an existing row is never overwritten. For demo/seed rows a
   * user may edit — the row seeds once, then belongs to the user (a re-seed
   * on redeploy leaves their edits intact). #1579.
   */
  insertOnly?: boolean
}

/**
 * Build an idempotent upsert statement.
 *
 * @param table   physical table name (e.g. `sales_events`)
 * @param byId    the conflict-target columns + values (a PK or unique key),
 *                e.g. `{ id }` — must map to a UNIQUE/PRIMARY KEY constraint.
 * @param values  the remaining columns to insert/update.
 * @param options `immutable` columns are set on insert but kept on update.
 */
export function buildUpsert(
  table: string,
  byId: Record<string, unknown>,
  values: Record<string, unknown> = {},
  options: UpsertOptions = {}
): string {
  const conflictCols = Object.keys(byId)
  if (conflictCols.length === 0) {
    throw new Error(`buildUpsert("${table}"): byId must have at least one column`)
  }
  const all: Record<string, unknown> = { ...values, ...byId }
  const cols = Object.keys(all)
  const immutable = new Set(options.immutable ?? [])

  const insertCols = cols.map(quoteIdent).join(', ')
  const insertVals = cols.map(c => sqlValue(all[c])).join(', ')
  const conflictTarget = conflictCols.map(quoteIdent).join(', ')

  const updateCols = cols.filter(c => !conflictCols.includes(c) && !immutable.has(c))

  let stmt = `INSERT INTO ${quoteIdent(table)} (${insertCols}) VALUES (${insertVals})`
  if (!options.insertOnly && updateCols.length > 0) {
    const setClause = updateCols
      .map(c => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
      .join(', ')
    stmt += ` ON CONFLICT(${conflictTarget}) DO UPDATE SET ${setClause}`
  } else {
    stmt += ` ON CONFLICT(${conflictTarget}) DO NOTHING`
  }
  return `${stmt};`
}
