/**
 * KDS feed — query plan + ticket assembly (#1766).
 *
 * Two pure halves of the kitchen-display read path, extracted from what used to
 * be inline handler code:
 *
 *  - `planDisplayJobsQuery` decides WHAT to ask the database for. Its job is to
 *    make the query's cost a function of the operator's configuration, never of
 *    how long the event has been running.
 *  - `shapeDisplayTickets` turns the flat result into the tickets a screen
 *    renders — one per `(order × location)`.
 *
 * ## Why this file exists
 *
 * The original endpoint fetched every non-cancelled order in the event, then
 * filtered out the bumped ones in JavaScript — binding one parameter per order
 * id through `inArray`. D1 refuses a query carrying more than 100 bound
 * parameters (https://developers.cloudflare.com/d1/platform/limits/), so order
 * #101 broke the board for the rest of the night. It was invisible because
 * local SQLite allows 32 766 parameters and the client swallowed the resulting
 * 500, leaving the kitchen looking at a frozen board (#1766).
 *
 * The fix is not chunking. Chunking an `inArray` keeps the query O(event); a
 * board only ever needs OPEN tickets. Moving the bump exclusion into SQL makes
 * it O(open) and removes the order-id list altogether, so event size becomes
 * structurally incapable of reaching the cap.
 *
 * Sibling contract, same root cause, different call site: `enqueuePrintJobs`
 * in crouton-printing (#1710).
 */

/**
 * How many locations one board may be configured with. Well below D1's cap
 * (`D1_MAX_BOUND_PARAMS` in `@fyit/crouton-core/shared/utils/d1` — the single
 * source of truth for the platform's number) on purpose: the plan binds a few
 * fixed parameters besides the locations, and the #1710 lesson is that a plan
 * sized exactly to the limit is already over it.
 */
export const MAX_CONFIGURABLE_LOCATIONS = 64

/** Rows fetched per refresh. A board shows tickets, not an event's history. */
export const DEFAULT_TICKET_LIMIT = 500

const CANCELLED_STATUS = 'cancelled'

/** One order item, joined to its product and left-joined to its bump. */
export interface TicketRow {
  orderId: string
  productId: string
  eventOrderNumber: number | null
  clientName: string | null
  isPersonnel: boolean | null
  createdAt: number | Date
  /** From the item's product. Null when the product has no prep location. */
  locationId: string | null
  productTitle: string | null
  quantity: number
  remarks: string | null
}

export interface DisplayTicketItem {
  title: string
  quantity: number
  remarks?: string
}

export interface DisplayTicket {
  id: string
  orderId: string
  locationId: string
  orderNumber: string
  clientName: string | null
  isPersonnel: boolean
  createdAt: string
  items: DisplayTicketItem[]
}

/**
 * An item that reaches no station. `schemas/products.json` marks `locationId`
 * required, so this is malformed data rather than a "needs no preparation"
 * case — a kitchen screen is the wrong place to raise it. We still count it, so
 * the drop is observable instead of the bare `continue` it used to be.
 */
export interface UnroutableItem {
  orderId: string
  productId: string
  quantity: number
}

export interface DisplayTicketsResult {
  tickets: DisplayTicket[]
  unroutable: UnroutableItem[]
}

export interface DisplayJobsQueryPlan {
  eventId: string
  locations: string[]
  limit: number
  /** Every value the query binds, in order. */
  params: unknown[]
  /** Bumped tickets are excluded by the query — this is what makes it O(open). */
  excludesBumpedInSql: true
  excludesCancelled: true
  /** An item with no prep location routes nowhere, on every board. */
  requiresLocation: true
}

export function planDisplayJobsQuery(input: {
  eventId: string
  locations?: string[]
  limit?: number
}): DisplayJobsQueryPlan {
  const locations = (input.locations ?? []).map(l => l.trim()).filter(Boolean)

  if (locations.length > MAX_CONFIGURABLE_LOCATIONS) {
    // Fail here, loudly and locally, rather than letting D1 reject the query
    // and the client quietly swallow the 500.
    throw new Error(
      `A kitchen display may be configured with at most ${MAX_CONFIGURABLE_LOCATIONS} locations (got ${locations.length})`
    )
  }

  const limit = input.limit ?? DEFAULT_TICKET_LIMIT

  return {
    eventId: input.eventId,
    locations,
    limit,
    // Fixed head + one per location + the limit. Nothing here scales with the
    // number of orders, which is the whole point.
    params: [input.eventId, CANCELLED_STATUS, ...locations, limit],
    excludesBumpedInSql: true,
    excludesCancelled: true,
    requiresLocation: true
  }
}

export function shapeDisplayTickets(rows: TicketRow[]): DisplayTicketsResult {
  const unroutable: UnroutableItem[] = []
  // Keyed by `${orderId}~${locationId}` so the kitchen and the bar clear the
  // same order independently.
  const byTicket = new Map<string, DisplayTicket>()
  const orderedAt = new Map<string, number>()

  for (const row of rows) {
    if (!row.locationId) {
      unroutable.push({
        orderId: row.orderId,
        productId: row.productId,
        quantity: row.quantity
      })
      continue
    }

    const key = `${row.orderId}~${row.locationId}`
    let ticket = byTicket.get(key)
    if (!ticket) {
      ticket = {
        id: key,
        orderId: row.orderId,
        locationId: row.locationId,
        orderNumber: row.eventOrderNumber != null ? String(row.eventOrderNumber) : '—',
        clientName: row.clientName ?? null,
        isPersonnel: row.isPersonnel ?? false,
        createdAt: new Date(row.createdAt).toISOString(),
        items: []
      }
      byTicket.set(key, ticket)
      orderedAt.set(key, new Date(row.createdAt).getTime())
    }

    const item: DisplayTicketItem = {
      // A product row that is gone yields no title; the raw id at least gives a
      // station something identifiable (the `my-orders-shape` convention).
      title: row.productTitle ?? row.productId,
      quantity: row.quantity
    }
    if (row.remarks != null) item.remarks = row.remarks
    ticket.items.push(item)
  }

  // Oldest first — a kitchen works orders in arrival order.
  const tickets = [...byTicket.values()].sort(
    (a, b) => (orderedAt.get(a.id) ?? 0) - (orderedAt.get(b.id) ?? 0)
  )

  return { tickets, unroutable }
}
