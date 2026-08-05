/**
 * "A cancelled order didn't happen", as a query condition (#1925).
 *
 * Five read models already skipped cancelled orders; all seven money/unit chart
 * endpoints did not. That asymmetry was invisible only because nothing could
 * produce* a cancelled order — #1941 adds the admin action, which is what turns
 * it into overstated revenue.
 *
 * The status VALUE lives in `shared/utils/order-status.ts` so the browser can
 * read it too; this module is the server-only half that builds the condition,
 * keeping drizzle out of the client bundle. It deliberately does not re-export
 * the constant: Nitro auto-imports every `server/utils/` export, so a re-export
 * would make the same symbol resolvable from two modules and Nuxt would warn
 * about duplicated imports (the lesson from #1867).
 *
 * ## What must NOT be swept in
 *
 * `print_failed` is not cancelled. That sale happened; a printer failed. Folding
 * it in here would under-report real money — the opposite error, and a quieter
 * one, because nobody checks whether revenue is too LOW.
 */
import { ne, type AnyColumn, type SQL } from 'drizzle-orm'
import { CANCELLED_ORDER_STATUS } from '../../shared/utils/order-status'

/**
 * Drizzle condition excluding cancelled orders — drop straight into `and(...)`.
 *
 * Takes the orders TABLE rather than the column so call sites read as
 * `excludesCancelledOrders(salesOrders)`, and so it cannot be pointed at some
 * other table's status column by accident.
 *
 * NULL-safe by construction, not by care: `ne()` yields NULL (⇒ excluded) for a
 * NULL row, but the generated column is `text('status').notNull()`. That
 * guarantee is pinned by a test, so relaxing the schema fails there rather than
 * silently deleting rows from every chart.
 */
export function excludesCancelledOrders(ordersTable: { status: AnyColumn }): SQL {
  return ne(ordersTable.status, CANCELLED_ORDER_STATUS)!
}
