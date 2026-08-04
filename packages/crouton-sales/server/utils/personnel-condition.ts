/**
 * The staff-order rule, as a condition over an injected column.
 *
 * Split out of `personnel-filter.ts` for one reason: that module imports
 * `salesOrders` from the consuming app's generated layer (`~~/layers/sales/...`)
 * at module scope, so anything importing it is unresolvable from a package unit
 * test — and from any query that receives its tables as parameters (#1867).
 *
 * The rule itself doesn't need the table, only the column, so it lives here and
 * `personnel-filter.ts` is now the thin binding that supplies `salesOrders`.
 * Same move as `location-handover.ts`: one rule, several callers, no second copy.
 */
import { eq, isNull, or, type AnyColumn, type SQL } from 'drizzle-orm'

export type PersonnelMode = 'all' | 'exclude' | 'only'

export function parsePersonnelMode(value: unknown): PersonnelMode {
  return value === 'exclude' || value === 'only' ? value : 'all'
}

/**
 * Drizzle condition for a personnel mode, or `undefined` for `all` — safe to
 * drop straight into `and(...)`, which ignores undefined args.
 *
 * `exclude` must keep NULLs: the column's default is a JS-side `$default`, not
 * a DB default, so pre-existing / non-drizzle rows read NULL and NULL means
 * "not a staff order".
 */
export function personnelConditionOn(column: AnyColumn, value: unknown): SQL | undefined {
  const mode = parsePersonnelMode(value)
  if (mode === 'only') return eq(column, true)
  if (mode === 'exclude') return or(eq(column, false), isNull(column))
  return undefined
}
