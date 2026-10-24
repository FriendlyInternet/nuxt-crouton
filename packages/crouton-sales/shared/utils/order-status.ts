/**
 * Order status values shared by the browser and the server (#1925/#1941).
 *
 * `cancelled` was spelled as a bare literal in five server files and about to
 * be spelled in the UI too. It sits here, beside `SALES_PRINT_STATUS`, for the
 * same reason that one does: both halves of the app must agree on it, and a
 * typo'd status silently means "no rows match" rather than an error.
 *
 * Deliberately dependency-free. The drizzle *condition* built from this lives
 * in `server/utils/order-status.ts` — importing drizzle from `shared/` would
 * drag the query builder into the client bundle.
 */

/** An order that didn't happen: excluded from every money/unit aggregation. */
export const CANCELLED_ORDER_STATUS = 'cancelled'

/**
 * NOT cancelled: the sale happened, a printer failed. Named here only to make
 * the distinction impossible to miss — folding it in with cancelled would
 * under-report real revenue, which is the quieter and worse mistake.
 */
export const PRINT_FAILED_ORDER_STATUS = 'print_failed'
