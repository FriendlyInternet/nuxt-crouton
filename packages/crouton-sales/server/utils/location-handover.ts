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
