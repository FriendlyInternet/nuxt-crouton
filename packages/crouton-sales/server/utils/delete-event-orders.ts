/**
 * @crouton-package crouton-sales
 * @description Pure cascade orchestration behind the Settings "Delete all
 * orders" danger-zone action (#1519).
 *
 * Wipes every order for ONE event, cascading orders → order items → this
 * event's print jobs, scoped strictly to the given `eventId` — never
 * team-wide. `salesClients` are deliberately NOT in the cascade: they're
 * reusable, and their open-tab totals reset naturally once the orders are
 * gone (owner's call, #1519). That's structural here — this surface has no
 * client op, so the orchestration cannot remove one.
 *
 * The four DB operations are injected (same deps-injection idiom as
 * printing-reactions.ts) so the sequencing + short-circuit logic is
 * unit-testable without a Nitro app or a live DB; the endpoint wires the real
 * drizzle-backed ops. See test/delete-event-orders.test.ts for the contract.
 */

export interface DeleteEventOrdersResult {
  orders: number
  items: number
  jobs: number
}

/**
 * The DB surface the cascade needs. Each op is scoped to a single event's
 * data by the caller; there is intentionally no client-deletion op.
 */
export interface DeleteEventOrdersOps {
  /** Order ids belonging to this event. */
  listOrderIds: (eventId: string) => Promise<string[]>
  /** Delete the order items for the given order ids; returns rows removed. */
  deleteOrderItems: (orderIds: string[]) => Promise<number>
  /** Delete this event's sales-domain print jobs; returns rows removed. */
  deleteEventPrintJobs: (eventId: string) => Promise<number>
  /** Delete this event's orders; returns rows removed. */
  deleteEventOrders: (eventId: string) => Promise<number>
}

/**
 * Delete all orders (and their items + print jobs) for one event.
 *
 * Order matters for referential tidiness (there are no FKs, but items/jobs go
 * before the orders they hang off). An event with zero orders short-circuits
 * the item delete — an empty id list is both pointless and, in some drivers,
 * an invalid `IN ()`.
 */
export async function deleteAllEventOrders(
  eventId: string,
  ops: DeleteEventOrdersOps
): Promise<DeleteEventOrdersResult> {
  const orderIds = await ops.listOrderIds(eventId)

  const items = orderIds.length > 0 ? await ops.deleteOrderItems(orderIds) : 0
  const jobs = await ops.deleteEventPrintJobs(eventId)
  const orders = await ops.deleteEventOrders(eventId)

  return { orders, items, jobs }
}
