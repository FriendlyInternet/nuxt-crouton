/**
 * Cancel one order — void a mis-punch without destroying the record (#1941).
 *
 * The counterpart to `delete-order.ts`. That one cascades the order, its items
 * and its print jobs away; this one flips a status and leaves everything else
 * alone. Two different intents, deliberately both kept: cancel = "didn't
 * happen, still on the books", delete = "gone from history".
 *
 * ## Why the scope is a parameter, not a convenience
 *
 * `orderId` arrives from a URL. An update keyed on it alone is a cross-tenant
 * write — anyone who can call the endpoint can cancel any order in the
 * database. Team AND event are part of the WHERE, so an id that doesn't belong
 * to the caller's scope matches zero rows and reports `not-found` rather than
 * succeeding quietly. `delete-order.ts` verifies ownership the same way.
 *
 * ## Why one statement rather than read-then-write
 *
 * A check-then-update is a race: two taps on a physical till both read
 * "not cancelled" and both write. Here the status predicate lives IN the update,
 * so the second tap matches nothing and reports `already-cancelled` — which is
 * the outcome the person wanted anyway. Same reasoning as `handover.ts`.
 *
 * The table is injected: it lives in the consuming app's generated layer, which
 * a package unit test cannot resolve.
 */
import { and, eq, ne } from 'drizzle-orm'
import { CANCELLED_ORDER_STATUS } from '../../shared/utils/order-status'

export type CancelOutcome = 'cancelled' | 'already-cancelled' | 'not-found'

export interface CancelOrderInput {
  /** The generated `salesOrders` table, passed by the endpoint. */
  table: any
  orderId: string
  /** Scope — both are part of the WHERE, never assumed from the id. */
  teamId: string
  eventId: string
  /** Who cancelled it; lands in updatedBy. */
  actor: string
}

/**
 * Who to record on the row: name if we have it, else the id, else a marker.
 *
 * Lives here rather than in the endpoint so it is reachable by a test — the
 * fallback chain is exactly the kind of small branchy helper that is never
 * exercised until the day a session has no `name` and the audit column reads
 * `undefined`.
 */
export function actorLabel(
  // Nullable on purpose: better-auth's `User` types `name` as nullable, so a
  // non-null shape here rejects the very value every caller passes.
  user: { name?: string | null, id?: string | null } | null | undefined
): string {
  return user?.name ?? user?.id ?? 'admin'
}

/** How many rows the driver says it wrote — drizzle/D1 spell this differently. */
function rowsWritten(result: unknown): number {
  const r = result as { rowsAffected?: number, changes?: number, meta?: { changes?: number } } | undefined
  return r?.rowsAffected ?? r?.changes ?? r?.meta?.changes ?? 0
}

export async function cancelOrder(
  db: any,
  input: CancelOrderInput
): Promise<{ outcome: CancelOutcome }> {
  const inScope = and(
    eq(input.table.id, input.orderId),
    eq(input.table.teamId, input.teamId),
    eq(input.table.eventId, input.eventId)
  )

  const result = await db
    .update(input.table)
    .set({
      status: CANCELLED_ORDER_STATUS,
      updatedAt: new Date(),
      updatedBy: input.actor
    })
    // The status predicate belongs here, not in a preceding SELECT — that is
    // what makes the double-tap a no-op instead of a race.
    .where(and(inScope, ne(input.table.status, CANCELLED_ORDER_STATUS)))

  if (rowsWritten(result) > 0) return { outcome: 'cancelled' }

  // Zero rows means either "already cancelled" or "not yours / doesn't exist",
  // and the endpoint owes the caller different answers for those: one is a
  // success, the other a 404. Only now is a read worth paying for.
  const [existing] = await db
    .select({ id: input.table.id })
    .from(input.table)
    .where(inScope)
    .limit(1)

  return { outcome: existing ? 'already-cancelled' : 'not-found' }
}
