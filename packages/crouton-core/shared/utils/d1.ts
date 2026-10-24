/**
 * @crouton-package crouton-core
 * @description Cloudflare D1's bound-parameter ceiling, and how to stay under it.
 *
 * D1 refuses any query carrying more than 100 BOUND PARAMETERS
 * (https://developers.cloudflare.com/d1/platform/limits/). A multi-row `INSERT` binds one per
 * column per row, so the limit is on `rows × columns` — write a batch in one statement and it
 * fails once the batch is big enough. Local SQLite allows 32 766, so this NEVER reproduces in
 * development: it only ever fires on deployed D1.
 *
 * It has bitten twice — the bulk product import (#1707) and the print-job enqueue on the
 * checkout path (#1710) — which is why the helper lives here rather than in either package.
 *
 * THE TRAP, and the reason `boundParamsPerRow` exists: drizzle also binds columns the row
 * object does NOT contain, whenever the column declares a default (`$default`/`$defaultFn`).
 * `Object.keys(row).length` therefore UNDERCOUNTS, and a chunk size derived from it can still
 * exceed the cap while looking correct — print jobs count 16 keys but bind 18. Always derive
 * the count from the table's columns, never from the row's own keys.
 */

/** D1's hard ceiling. Not tunable — this is the platform's number. */
export const D1_MAX_BOUND_PARAMS = 100

/** The shape we need off a drizzle column; kept structural so `shared/` stays dependency-free. */
export interface ColumnLike { hasDefault?: boolean }

/**
 * How many parameters drizzle will actually bind for one row of this table.
 *
 * A column is bound when the row supplies it, OR when it declares a default that drizzle
 * fills in. A column that is neither supplied nor defaulted is omitted from the statement
 * entirely, so it costs nothing.
 *
 * Pass `getTableColumns(table)` from drizzle-orm as `columns`.
 */
export function boundParamsPerRow(
  columns: Record<string, ColumnLike>,
  row: Record<string, unknown>,
): number {
  let count = 0
  for (const [name, column] of Object.entries(columns)) {
    if (name in row || column?.hasDefault) count++
  }
  return count
}

/**
 * Split rows into batches that each stay within the parameter cap.
 *
 * `columnsPerRow` is REQUIRED rather than inferred: inferring it from the row's own keys is
 * exactly the undercount described above, and a silent undercount reproduces the very bug
 * this helper exists to prevent. Use `boundParamsPerRow` (or `chunkRowsForTable`) to get it.
 *
 * A row too wide to ever fit still yields one row per batch — a batch size of 0 would spin
 * forever. Such a statement will fail at D1, but that is a schema problem this cannot solve,
 * and failing loudly beats hanging.
 */
export function chunkForBoundParams<T>(
  rows: T[],
  columnsPerRow: number,
  maxParams: number = D1_MAX_BOUND_PARAMS,
): T[][] {
  if (!rows.length) return []
  const size = Math.max(Math.floor(maxParams / Math.max(columnsPerRow, 1)), 1)
  const chunks: T[][] = []
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
  return chunks
}

/**
 * Derive the per-row cost from the table, then chunk — the call every insert site wants:
 *
 * ```ts
 * for (const batch of chunkRowsForTable(rows, getTableColumns(printJobs))) {
 *   await db.insert(printJobs).values(batch)
 * }
 * ```
 *
 * Batches are NOT one transaction. A mid-run failure leaves earlier batches written, so the
 * caller owns recovery (the product import re-detects written rows as duplicates; a failed
 * ticket enqueue throws so checkout can surface it).
 */
export function chunkRowsForTable<T extends Record<string, unknown>>(
  rows: T[],
  columns: Record<string, ColumnLike>,
  maxParams: number = D1_MAX_BOUND_PARAMS,
): T[][] {
  if (!rows.length) return []
  return chunkForBoundParams(rows, boundParamsPerRow(columns, rows[0]!), maxParams)
}
