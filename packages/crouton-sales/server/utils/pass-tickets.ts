/**
 * Pass-screen feed — query plan + ticket assembly (#1761, epic #1755).
 *
 * The second stage of the KDS loop. Stations press READY (one `sales_kdsbumps`
 * row per order × location); an order becomes ready to hand over only once
 * EVERY location it touches has gone ready. A runner at the pass then carries
 * the whole order out and taps HANDED TO CUSTOMER, which writes the
 * `sales_handovers` row this feed excludes on.
 *
 * Split the same way as the KDS feed (`kds-tickets.ts`): a pure planner that
 * decides what to ask the database for, and a pure shaper that turns the flat
 * rows into tickets. Both are DB-free so the behaviour is unit-testable — the
 * lesson of #1766, where the equivalent logic lived inline in a handler and went
 * untested until it broke in production.
 *
 * ## The parameter cap applies here too (#1766)
 *
 * The readiness rule is tempting to implement as: fetch the event's orders,
 * collect their ids, then query bumps with `inArray(orderId, ids)`. That is
 * exactly the shape that broke the KDS board — D1 rejects a query over 100 bound
 * parameters, and local SQLite (32 766) can never reproduce it. So this plan
 * takes NO order ids: the handover exclusion lives in SQL, and readiness is
 * computed from the flat join result in `shapePassTickets`.
 */
import type { DisplayTicketItem, UnroutableItem } from './kds-tickets'
import { DEFAULT_TICKET_LIMIT } from './kds-tickets'

const CANCELLED_STATUS = 'cancelled'

/**
 * What "still waiting" means, in one place. WS4 (#1763) renders this number on
 * the admin orders page AND the live dashboard; both read it from here rather
 * than re-deriving it, so the two surfaces cannot disagree.
 */
export const OUTSTANDING_DEFINITION = {
  excludesCancelled: true,
  excludesHandedOver: true
} as const

/** One order item, joined to its product and left-joined to its location's bump. */
export interface PassRow {
  orderId: string
  productId: string
  eventOrderNumber: number | null
  clientName: string | null
  isPersonnel: boolean | null
  createdAt: number | Date
  /** From the item's product. Null when the product has no prep location. */
  locationId: string | null
  /** Whether this item's location has gone ready. */
  bumped: boolean
  productTitle: string | null
  quantity: number
  remarks: string | null
}

export interface PassTicket {
  orderId: string
  orderNumber: string
  clientName: string | null
  isPersonnel: boolean
  createdAt: string
  /**
   * True when the order contains an item that reaches no station. The runner is
   * warned before carrying it out — see the readiness note below.
   */
  incomplete: boolean
  items: DisplayTicketItem[]
}

export interface PassTicketsResult {
  tickets: PassTicket[]
  unroutable: UnroutableItem[]
}

export interface OutstandingCountPlan {
  teamId: string
  eventId: string
  /** Exactly the two scoping values. Nothing else can reach this query. */
  params: unknown[]
  excludesCancelled: true
  excludesHandedOver: true
}

/**
 * Plan the "how many orders are people still waiting for?" count (#1763).
 *
 * Takes ONLY the tenant and the event — deliberately no filters, and not as an
 * omission that a later change might quietly correct.
 *
 * The orders list endpoint shares one `buildWhere` between its rows and its
 * total, so a filtered page and its total agree; that is right for a paginated
 * table. Reusing it here would be silently wrong: picking a helper from the
 * filter dropdown would change the backlog from 40 to 3. A number that moves
 * when you filter the table is worse than no number, because it still looks
 * authoritative. So this plan cannot receive a filter at all.
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

export interface PassJobsQueryPlan {
  eventId: string
  limit: number
  /** Every value the query binds, in order. Never grows with the event. */
  params: unknown[]
  excludesHandedOverInSql: true
  excludesCancelled: true
}

export function planPassJobsQuery(input: {
  eventId: string
  limit?: number
}): PassJobsQueryPlan {
  const limit = input.limit ?? DEFAULT_TICKET_LIMIT

  return {
    eventId: input.eventId,
    limit,
    params: [input.eventId, CANCELLED_STATUS, limit],
    excludesHandedOverInSql: true,
    excludesCancelled: true
  }
}

export function shapePassTickets(rows: PassRow[]): PassTicketsResult {
  const unroutable: UnroutableItem[] = []
  const byOrder = new Map<string, PassRow[]>()

  for (const row of rows) {
    const list = byOrder.get(row.orderId) ?? []
    list.push(row)
    byOrder.set(row.orderId, list)

    if (!row.locationId) {
      unroutable.push({
        orderId: row.orderId,
        productId: row.productId,
        quantity: row.quantity
      })
    }
  }

  const tickets: PassTicket[] = []

  for (const [orderId, orderRows] of byOrder) {
    const routable = orderRows.filter(r => r.locationId)

    // An unroutable item can never be bumped — no station ever sees it (#1766).
    // If it counted toward readiness the order would sit invisible at the pass
    // FOREVER, which is #1766's silent stall one stage later. So readiness is
    // judged on the routable items only, and the shortfall is flagged instead.
    if (routable.length === 0) continue
    if (!routable.every(r => r.bumped)) continue

    const head = orderRows[0]!
    tickets.push({
      orderId,
      orderNumber: head.eventOrderNumber != null ? String(head.eventOrderNumber) : '—',
      clientName: head.clientName ?? null,
      isPersonnel: head.isPersonnel ?? false,
      createdAt: new Date(head.createdAt).toISOString(),
      incomplete: routable.length !== orderRows.length,
      // The whole order, un-split — a station sees its own lines, the runner
      // carries the lot. Unroutable items are listed too, so the runner can see
      // what is missing rather than discovering it at the customer.
      items: orderRows.map((r) => {
        const item: DisplayTicketItem = {
          title: r.productTitle ?? r.productId,
          quantity: r.quantity
        }
        if (r.remarks != null) item.remarks = r.remarks
        return item
      })
    })
  }

  // Oldest first — at the pass, the oldest complete order is the one somebody
  // has been waiting on longest.
  tickets.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  return { tickets, unroutable }
}
