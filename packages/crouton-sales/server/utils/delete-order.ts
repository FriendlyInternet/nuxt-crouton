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

// The slim order shape the ownership guard reads.
export interface OrderOwnershipRow {
  id: string
  eventId: string
  teamId: string
}

/**
 * Pure predicate: does this fetched order row belong to the given event AND
 * team? A missing row (undefined/null) is never owned. Extracted so the
 * endpoint's guard is one tested call instead of a branchy inline condition.
 */
export function isOrderOwnedBy(
  order: OrderOwnershipRow | null | undefined,
  eventId: string,
  teamId: string
): boolean {
  return !!order && order.eventId === eventId && order.teamId === teamId
}

/**
 * Look up an order and return it ONLY if it belongs to this event + team,
 * else null. Keeps the ownership select + check out of the HTTP handler (which
 * stays a thin compose that just maps null → 404).
 */
export async function findOwnedOrder(
  orderId: string,
  eventId: string,
  teamId: string,
  deps: DeleteOrderCascadeDeps
): Promise<OrderOwnershipRow | null> {
  const { db, tables } = deps
  const { salesOrders } = tables
  const { eq } = deps.ops ?? { eq: defaultEq, and: defaultAnd }

  const [order] = await db
    .select({ id: salesOrders.id, eventId: salesOrders.eventId, teamId: salesOrders.teamId })
    .from(salesOrders)
    .where(eq(salesOrders.id, orderId))
    .limit(1)

  return isOrderOwnedBy(order, eventId, teamId) ? (order as OrderOwnershipRow) : null
}

export async function deleteOrderCascade(
  orderId: string,
  deps: DeleteOrderCascadeDeps
): Promise<DeleteOrderCascadeResult> {
  const { db, tables } = deps
  const { salesOrders, salesOrderitems, printJobs } = tables
  const { eq, and } = deps.ops ?? { eq: defaultEq, and: defaultAnd }

  // Line items — keyed by the order.
  const deletedItems = await db
    .delete(salesOrderitems)
    .where(eq(salesOrderitems.orderId, orderId))
    .returning({ id: salesOrderitems.id })

  // Print jobs — SCOPED to this order's sales tickets in the shared queue.
  // Never a bare orderId match: print_jobs is cross-domain and keyed by the
  // opaque source/refType/refId triple, so a looser filter would reach into
  // other orders' (or other packages') jobs.
  const deletedJobs = await db
    .delete(printJobs)
    .where(and(
      eq(printJobs.source, 'sales'),
      eq(printJobs.refType, 'order'),
      eq(printJobs.refId, orderId)
    ))
    .returning({ id: printJobs.id })

  // The order row itself — last, so a mid-cascade failure leaves the order
  // visible (and re-deletable) rather than orphaning its children.
  await db
    .delete(salesOrders)
    .where(eq(salesOrders.id, orderId))

  return { deletedItems: deletedItems.length, deletedJobs: deletedJobs.length }
}
