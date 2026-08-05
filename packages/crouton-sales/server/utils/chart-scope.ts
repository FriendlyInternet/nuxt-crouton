/**
 * The WHERE every sales chart endpoint shares (#1925).
 *
 * All eight chart endpoints opened with the same four conditions — team,
 * optional event, the personnel toggle, and (as of #1925) "not cancelled".
 * Eight copies of one clause is how the cancelled filter came to be missing
 * from all of them at once: there was no single place to add it.
 *
 * Now there is. `chartOrderScope(salesOrders, query)` is the whole clause, so a
 * ninth chart endpoint inherits every rule — including ones added later — by
 * construction rather than by remembering.
 *
 * ## The one opt-out
 *
 * `orders-by-status` groups BY status, so excluding cancelled orders would
 * delete the bucket it exists to show. It passes `includeCancelled: true`. A
 * named flag, not a hand-rolled WHERE: the exemption stays visible, and it still
 * inherits the team/event/personnel rules it must not diverge on.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm'
import { excludesCancelledOrders } from './order-status'
import { personnelFilter } from './personnel-filter'

/**
 * An order's calendar day, for the charts that bucket by date.
 *
 * `createdAt` is stored as integer Unix SECONDS, so the `'unixepoch'` modifier
 * is required — without it SQLite reads the number as a Julian day and every
 * row lands in the year 4700-odd. Shared by `revenue-by-day`,
 * `units-per-product-day` and `product-day-matrix` so the three cannot bucket
 * differently and disagree about which day a late-night order belongs to.
 */
export function salesOrderDay(salesOrders: any): SQL<string> {
  return sql<string>`date(${salesOrders.createdAt}, 'unixepoch')`
}

export interface ChartScopeQuery {
  teamId: string
  /** Optional `?eventId=` — omitted ⇒ team-wide. */
  eventId?: unknown
  /** `?personnel=` — all | exclude | only. */
  personnel?: unknown
}

/**
 * Scope + filters for a chart aggregation over `salesOrders`.
 *
 * `includeCancelled` exists for exactly one caller; anything else passing it is
 * almost certainly reporting money that was never taken.
 */
export function chartOrderScope(
  salesOrders: any,
  query: ChartScopeQuery,
  options: { includeCancelled?: boolean } = {}
): SQL {
  return and(
    eq(salesOrders.teamId, query.teamId),
    query.eventId ? eq(salesOrders.eventId, String(query.eventId)) : undefined,
    personnelFilter(query.personnel),
    options.includeCancelled ? undefined : excludesCancelledOrders(salesOrders)
  )!
}
