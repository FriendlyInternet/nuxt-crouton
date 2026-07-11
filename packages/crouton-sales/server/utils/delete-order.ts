import { and as defaultAnd, eq as defaultEq } from 'drizzle-orm'

/**
 * Hard-delete one sales order and everything that hangs off it (#1518).
 *
 * The order's line items live in `sales_orderitems` (keyed by `orderId`); the
 * order's tickets live in the GENERIC crouton-printing `print_jobs` queue
 * (epic #325), where the back-reference is `source='sales'`, `refType='order'`,
 * `refId=orderId` — NOT a bare `orderId` column. Deleting print jobs by anything
 * looser than that triple would reach into other domains' / other orders' jobs,
 * so the scoping is the correctness contract this util exists to guarantee.
 *
 * Ownership (team + event) is verified by the caller BEFORE this runs — this is
 * the pure cascade, so it can be unit-tested with a fake db. Returns how many
 * rows each cascade removed.
 */

// Minimal shapes so the util is unit-testable with injected fakes (mirrors the
// printing-reactions pattern) while defaulting to real drizzle in production.
export interface DeleteOrderCascadeTables {
  salesOrders: any
  salesOrderitems: any
  printJobs: any
}

export interface DeleteOrderCascadeOps {
  eq: typeof defaultEq
  and: typeof defaultAnd
}

export interface DeleteOrderCascadeDeps {
  db: any
  tables: DeleteOrderCascadeTables
  /** Injectable for tests; defaults to real drizzle operators. */
  ops?: DeleteOrderCascadeOps
}

export interface DeleteOrderCascadeResult {
  deletedItems: number
  deletedJobs: number
}

export async function deleteOrderCascade(
  _orderId: string,
  _deps: DeleteOrderCascadeDeps
): Promise<DeleteOrderCascadeResult> {
  // Implemented after test sign-off (#1518) — red first.
  throw new Error('deleteOrderCascade not implemented')
}
