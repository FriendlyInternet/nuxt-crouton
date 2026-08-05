import { and, eq, exists, ne, sql, type SQL } from 'drizzle-orm'
import { locationBlocksDeliverySql } from './location-handover'

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

/**
 * The tables the outstanding predicate reads. INJECTED, not imported — they live
 * in the consuming app's generated layer (`~~/layers/sales/...`), which a package
 * unit test cannot resolve. Keeping them parameters is what makes this testable
 * at all (same reason as `handover.ts` / `per-product-totals.ts`).
 */
export interface OutstandingOrderTables {
  orders: any
  orderitems: any
  products: any
  locations: any
  kdsbumps: any
}

/**
 * "Still in bereiding", as a WHERE condition over the ORDERS list (#1875).
 *
 * The count and the list must answer the same sentence. They stopped doing so
 * once: #1846 applied this rule to the list keyed on `salesHandovers`; #1851
 * re-pointed the COUNT onto `salesKdsbumps` and left the list behind — so
 * `?outstanding=1` was parsed, sent, and silently ignored while the chip above
 * the list still lit up. The per-location half delegates to
 * `locationBlocksDeliverySql`, so there is ONE predicate for "does this location
 * still owe something" and nothing left for the two callers to disagree about.
 *
 * A correlated EXISTS, not a join: composes with the owner/client/print filters
 * without changing the row shape or duplicating rows.
 *
 * Cancelled is excluded HERE, not globally — the unfiltered list still shows
 * cancelled orders; only this filter claims to be about what is still coming.
 */
export function outstandingOrdersCondition(db: any, tables: OutstandingOrderTables): SQL {
  const { orders, orderitems, products, locations, kdsbumps } = tables
  return and(
    ne(orders.status, 'cancelled'),
    exists(
      db.select({ one: sql`1` })
        .from(orderitems)
        .innerJoin(products, eq(products.id, orderitems.productId))
        .innerJoin(locations, eq(locations.id, products.locationId))
        .leftJoin(kdsbumps, and(
          eq(kdsbumps.orderId, orderitems.orderId),
          eq(kdsbumps.locationId, products.locationId)
        ))
        .where(and(
          eq(orderitems.orderId, orders.id),
          locationBlocksDeliverySql({
            bumpId: kdsbumps.id,
            requiresHandover: locations.requiresHandover
          })
        ))
    )
  )!
}

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
