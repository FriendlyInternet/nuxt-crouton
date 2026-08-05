/**
 * The outstanding-orders rule (#1763, re-pointed by #1851).
 *
 * "Still to deliver" = an order, not cancelled, that has at least one location
 * REQUIRING send-out confirmation with no bump. Locations that opted out never
 * hold an order open — see `location-handover.ts` for the per-order predicate.
 *
 * This file used to carry the pass-screen feed too. That model (stations mark
 * ready, a separate pass marks handed-over) was replaced: sending out is
 * location-dependent, so the kitchen-display tap IS the send-out.
 */

/**
 * What "still to deliver" means, in one place, so the orders pane and the
 * dashboard tile cannot drift.
 */
export const OUTSTANDING_DEFINITION = {
  excludesCancelled: true,
  excludesHandedOver: true
} as const

export interface OutstandingCountPlan {
  teamId: string
  eventId: string
  /** Exactly the two scoping values. No filter can reach this query. */
  params: unknown[]
  excludesCancelled: true
  excludesHandedOver: true
}

/**
 * Takes ONLY the tenant and the event — deliberately no filters.
 *
 * The orders list shares one `buildWhere` between its rows and its total so a
 * filtered page and its total agree. Reusing that here would make the backlog
 * follow the helper dropdown and read 3 instead of 40; a number that moves when
 * you filter the table is worse than none, because it still looks authoritative.
 */
export function planOutstandingCount(input: {
  teamId: string
  eventId: string
}): OutstandingCountPlan {
  return {
    teamId: input.teamId,
    eventId: input.eventId,
    params: [input.teamId, input.eventId],
    ...OUTSTANDING_DEFINITION
  }
}
