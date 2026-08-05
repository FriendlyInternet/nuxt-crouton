/**
 * Per-product totals endpoint (#1867) — "moeten we nog pils bijbestellen?"
 *
 * Returns one row per product with `sold` (units gone from the cellar) and
 * `outstanding` (units a location still owes the customer, or **null** when no
 * backlog is possible there). Backs `salesPerProductBlock` in the Data pane.
 *
 * Sits with the other `charts/*` endpoints because it shares their contract —
 * team-members-only, optional `?eventId=`, `?personnel=` — but it deliberately
 * does NOT return the `{ items }` chart-widget shape: this feeds a bespoke
 * two-column list, not `CroutonChartsWidget`.
 *
 * The aggregation itself is the injectable, unit-tested `per-product-totals`
 * util (`test/per-product-totals.test.ts`), so this handler stays a thin
 * auth → resolve tables → delegate — the same split as `orders.get.ts`.
 */
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
import { buildPerProductTotals } from '../../../../../utils/per-product-totals'

export default defineEventHandler(async (event) => {
  const { team } = await resolveTeamAndCheckMembership(event)
  const db = useDB()

  const { eventId, personnel } = getQuery(event)
  if (!eventId) {
    // Unlike the other chart endpoints this is event-scoped by nature: a
    // backlog is a property of one running event, and summing "still to
    // deliver" across finished events would be a meaningless number that still
    // looks authoritative.
    throw createError({ status: 400, statusText: 'eventId is required' })
  }

  const { salesOrders } = await import('~~/layers/sales/collections/orders/server/database/schema')
  const { salesOrderitems } = await import('~~/layers/sales/collections/orderitems/server/database/schema')
  const { salesProducts } = await import('~~/layers/sales/collections/products/server/database/schema')
  const { salesLocations } = await import('~~/layers/sales/collections/locations/server/database/schema')
  const { salesKdsbumps } = await import('~~/layers/sales/collections/kdsbumps/server/database/schema')

  const items = await buildPerProductTotals(
    db,
    {
      orders: salesOrders,
      orderitems: salesOrderitems,
      products: salesProducts,
      locations: salesLocations,
      kdsbumps: salesKdsbumps
    },
    { teamId: team.id, eventId: String(eventId), personnel }
  )

  return { items }
})
