/**
 * Send-out confirmation per location (#1851).
 *
 * Sending out is LOCATION-DEPENDENT: each station hands its own part straight
 * to the customer, so the kitchen-display tap IS the send-out signal. There is
 * no separate pass stage (that was epic #1755's model, replaced here).
 *
 * A location can opt out via `requiresHandover: false` — its part never reaches
 * a screen and counts as delivered the moment the order is placed. A bar handing
 * a pils across the counter has nothing to confirm.
 */

import { and, eq, isNull, or, type AnyColumn, type SQL } from 'drizzle-orm'

export interface OrderLocationState {
  locationId: string
  /** Null on rows predating the migration — treated as requiring. */
  requiresHandover: boolean | null
  bumped: boolean
}

/**
 * Does this location still owe the customer something?
 *
 * Null counts as REQUIRING. A row that predates the migration must not read as
 * "nothing to confirm" — that would mark every historical order delivered on
 * sight, which is exactly what the migration's backfill exists to prevent.
 */
export function locationBlocksDelivery(l: OrderLocationState): boolean {
  const requires = l.requiresHandover ?? true
  return requires && !l.bumped
}

/**
 * An order is delivered when no location still owes anything.
 *
 * Opt-out locations can never hold an order open, and a stale bump left behind
 * by flipping the switch off mid-event doesn't change the verdict either way —
 * the flag is read fresh, the bump only matters where it's required.
 *
 * An order touching no locations is delivered: there is nothing to hand out, and
 * leaving it queued forever would be the #1766 stall in a new costume.
 */
export function isOrderDelivered(locations: OrderLocationState[]): boolean {
  return !locations.some(locationBlocksDelivery)
}

/**
 * The same rule, as a SQL predicate — for the queries that must decide this in
 * the database rather than over fetched rows.
 *
 * ## Why this exists
 *
 * `locationBlocksDelivery` above answers the question for a row already in
 * memory. Two queries need to answer it *while aggregating*, where pulling
 * every order into JS is not an option: the Bestellingen backlog counter
 * (`orders.get.ts`) and the per-product view (#1867). Before this function, the
 * counter re-implemented the rule inline as SQL — one sentence with two
 * independent implementations, which is the shape that drifts. A third copy was
 * about to be added.
 *
 * So both callers import THIS. Not "both are tested to agree" — there is only
 * one predicate, so there is nothing left to disagree. `per-product-totals.test.ts`
 * additionally pins it to the same truth table `locationBlocksDelivery` answers,
 * so the SQL and the TypeScript halves cannot part ways either.
 *
 * Expects the caller to have LEFT JOINed the bump rows for the order/location
 * pair — `bumpId` null means "no bump", which is what makes this readable as a
 * plain condition rather than a correlated subquery.
 */
export function locationBlocksDeliverySql(cols: {
  /** `id` of the LEFT JOINed bump row — null when this location hasn't bumped. */
  bumpId: AnyColumn
  /** The location's `requiresHandover`. Null (pre-migration) counts as requiring. */
  requiresHandover: AnyColumn
}): SQL {
  return and(
    isNull(cols.bumpId),
    // Mirrors `requiresHandover ?? true` above: NULL must read as REQUIRING, and
    // SQL's three-valued logic will not do that for us — `requiresHandover = 1`
    // alone is NULL (not true) for a legacy row, silently dropping it.
    or(isNull(cols.requiresHandover), eq(cols.requiresHandover, true))
  )!
}
