/**
 * Personnel (staff) order filter for the analytics/chart endpoints.
 *
 * Orders carry an `isPersonnel` boolean (the cart "Staff order" switch). By
 * default every chart/total counts them; the Data pane lets an admin drop them
 * so the headline numbers reflect customer sales, plus watch staff consumption
 * on its own. This is the single place that translates the `?personnel=` query
 * param into a WHERE condition, so all eight chart endpoints stay consistent.
 *
 * Modes:
 *   - `all` (default / omitted) — no condition, unchanged behaviour. Keeps the
 *     public `salesChartBlock` + live dashboard exactly as they were.
 *   - `exclude` — customer sales only. The column is NULLABLE (its default is a
 *     JS-side `$default`, not a DB default), so pre-existing / non-drizzle rows
 *     can be NULL; NULL means "not a staff order", so it must be kept.
 *   - `only` — personnel orders only (the dedicated staff graph).
 */
import { eq, isNull, or, type SQL } from 'drizzle-orm'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'

export type PersonnelMode = 'all' | 'exclude' | 'only'

export function parsePersonnelMode(value: unknown): PersonnelMode {
  return value === 'exclude' || value === 'only' ? value : 'all'
}

/**
 * Drizzle condition for a personnel mode, or `undefined` for `all` — safe to
 * drop straight into `and(...)`, which ignores undefined args.
 */
export function personnelFilter(value: unknown): SQL | undefined {
  const mode = parsePersonnelMode(value)
  if (mode === 'only') return eq(salesOrders.isPersonnel, true)
  if (mode === 'exclude') return or(eq(salesOrders.isPersonnel, false), isNull(salesOrders.isPersonnel))
  return undefined
}
