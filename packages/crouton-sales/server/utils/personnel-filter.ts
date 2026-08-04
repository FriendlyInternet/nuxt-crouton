/**
 * Personnel (staff) order filter for the analytics/chart endpoints.
 *
 * Orders carry an `isPersonnel` boolean (the cart "Staff order" switch). By
 * default every chart/total counts them; the Data pane lets an admin drop them
 * so the headline numbers reflect customer sales, plus watch staff consumption
 * on its own. This is the single place that binds the `?personnel=` query param
 * to the orders table, so all eight chart endpoints stay consistent.
 *
 * The rule ITSELF lives in `personnel-condition.ts` — this module is only the
 * binding that supplies `salesOrders`. The split exists because that import is
 * unresolvable from a package unit test and from a query that receives its
 * tables as parameters (#1867); a caller that already holds the column should
 * use `personnelConditionOn` rather than grow a second copy of the rule.
 *
 * Modes:
 *   - `all` (default / omitted) — no condition, unchanged behaviour. Keeps the
 *     public `salesChartBlock` + live dashboard exactly as they were.
 *   - `exclude` — customer sales only. The column is NULLABLE (its default is a
 *     JS-side `$default`, not a DB default), so pre-existing / non-drizzle rows
 *     can be NULL; NULL means "not a staff order", so it must be kept.
 *   - `only` — personnel orders only (the dedicated staff graph).
 */
import type { SQL } from 'drizzle-orm'
import { personnelConditionOn } from './personnel-condition'
import { salesOrders } from '~~/layers/sales/collections/orders/server/database/schema'

// NB: `parsePersonnelMode` / `PersonnelMode` are deliberately NOT re-exported
// here. Nitro auto-imports every export under `server/utils/`, so a re-export
// makes the same symbol resolvable from two modules and Nuxt picks one with a
// "Duplicated imports" warning. Import them from `./personnel-condition`.

/**
 * Drizzle condition for a personnel mode, or `undefined` for `all` — safe to
 * drop straight into `and(...)`, which ignores undefined args.
 */
export function personnelFilter(value: unknown): SQL | undefined {
  return personnelConditionOn(salesOrders.isPersonnel, value)
}
