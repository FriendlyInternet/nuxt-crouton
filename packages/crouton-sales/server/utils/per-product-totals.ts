/**
 * Per-product totals for the Data pane (#1867).
 *
 * Answers the question an operator asks standing at the bar mid-event —
 * "moeten we nog pils bijbestellen?" — and, beside it, "wat moet de keuken
 * nog buiten krijgen?". Two numbers per product:
 *
 *   - **sold**        units that left the cellar, delivered or not
 *   - **outstanding** units a location still owes the customer
 *
 * ## Why both, and why `outstanding` can be null
 *
 * Sold alone is the stock answer; outstanding alone cannot be, because since
 * #1851 a location can opt out of send-out confirmation (`requiresHandover:
 * false`). A bar handing a pils straight across the counter never appears in an
 * outstanding view at all — so an outstanding-only view would answer the stock
 * question with silence for exactly the products it was asked about.
 *
 * That is also why an opt-out product reports `outstanding: null` rather than
 * `0`. The bar *cannot* have a backlog, which is a different statement from
 * "has none right now": a `0` reads as "all caught up" and invites the operator
 * to wait for a number that will never move. Null renders as "—".
 *
 * ## Why two queries rather than one
 *
 * Joining the bump rows in to compute both measures at once would let the bump
 * join fan the item rows out — `sales_kdsbumps` has no uniqueness constraint
 * (see `handover.ts`), so a double-tapped location can hold two rows and would
 * silently double that product's `sold`. Splitting them keeps `sold` on a join
 * path that cannot duplicate, and costs one extra round trip on a query whose
 * parameter count is fixed by the scope rather than by the data (#1766).
 *
 * Tables are injected, not imported: they live in the consuming app's generated
 * layer (`~~/layers/sales/...`), which a package unit test cannot resolve — the
 * same reason `handover.ts` takes its table as a parameter.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { locationBlocksDeliverySql } from './location-handover'
import { excludesCancelledOrders } from './order-status'
import { personnelConditionOn } from './personnel-condition'
import { productCategoryCondition } from './product-category-filter'

export interface PerProductTables {
  orders: any
  orderitems: any
  products: any
  locations: any
  kdsbumps: any
}

export interface PerProductRow {
  productId: string
  product: string
  /** Prep location's name, or null when the product has none. */
  location: string | null
  /** Units sold — gone from the cellar, delivered or not. */
  sold: number
  /**
   * Units still owed to a customer, or **null** when no backlog is possible:
   * the location opted out of confirmation, or the product has no location at
   * all (it never reaches a screen, so no bump can ever arrive).
   */
  outstanding: number | null
}

export interface PerProductTotalsInput {
  teamId: string
  eventId: string
  /** `all` | `exclude` | `only` — the Data pane's staff toggle. */
  personnel?: unknown
  /** Optional product/category narrowing (#2146) — see `product-category-filter.ts`. */
  productIds?: unknown
  categoryIds?: unknown
}

export async function buildPerProductTotals(
  db: any,
  tables: PerProductTables,
  input: PerProductTotalsInput
): Promise<PerProductRow[]> {
  const { orders, orderitems, products, locations, kdsbumps } = tables

  // `quantity` is TEXT in the generated schema — the same cast every chart
  // endpoint does. Casting a numeric column is a no-op, so this is safe either way.
  const units = sql<number>`sum(cast(${orderitems.quantity} as real))`

  // Shared by both measures so they can never disagree about which orders count.
  // Cancelled is excluded from BOTH: a cancelled order is a mis-punch, not
  // consumption, and must not inflate "do we need to order more".
  const inScope = and(
    eq(orders.teamId, input.teamId),
    eq(orders.eventId, input.eventId),
    excludesCancelledOrders(orders),
    personnelConditionOn(orders.isPersonnel, input.personnel),
    productCategoryCondition(products.id, products.categoryId, {
      productIds: input.productIds,
      categoryIds: input.categoryIds
    })
  )

  // --- sold -----------------------------------------------------------------
  // No bump join on this path, so nothing can fan the item rows out.
  const soldRows = await db
    .select({
      productId: products.id,
      product: products.title,
      location: locations.title,
      requiresHandover: locations.requiresHandover,
      locationId: products.locationId,
      units
    })
    .from(orderitems)
    .innerJoin(orders, eq(orderitems.orderId, orders.id))
    .innerJoin(products, eq(products.id, orderitems.productId))
    .leftJoin(locations, eq(locations.id, products.locationId))
    .where(inScope)
    // The joined location columns are grouped explicitly rather than left bare.
    // SQLite tolerates a bare column, but they are not functionally dependent on
    // `products.id` from the *joined* table's perspective, so a Postgres-dialect
    // consumer would reject the query outright.
    .groupBy(products.id, products.title, products.locationId, locations.title, locations.requiresHandover)
    .orderBy(desc(units))

  // --- outstanding ----------------------------------------------------------
  // INNER join on locations: a product with no location reaches no screen, so
  // it can never be outstanding. The blocking rule itself is the shared
  // predicate — this query does NOT re-derive "still waiting" (#1867).
  const outstandingRows = await db
    .select({ productId: products.id, units })
    .from(orderitems)
    .innerJoin(orders, eq(orderitems.orderId, orders.id))
    .innerJoin(products, eq(products.id, orderitems.productId))
    .innerJoin(locations, eq(locations.id, products.locationId))
    .leftJoin(kdsbumps, and(
      eq(kdsbumps.orderId, orders.id),
      eq(kdsbumps.locationId, products.locationId)
    ))
    .where(and(
      inScope,
      locationBlocksDeliverySql({
        bumpId: kdsbumps.id,
        requiresHandover: locations.requiresHandover
      })
    ))
    .groupBy(products.id)

  const outstandingByProduct = new Map<string, number>(
    (outstandingRows as Array<{ productId: string, units: number }>)
      .map(r => [r.productId, Number(r.units) || 0])
  )

  return (soldRows as Array<{
    productId: string
    product: string
    location: string | null
    requiresHandover: boolean | null
    locationId: string | null
    units: number
  }>).map((row) => {
    // Null (pre-migration) counts as REQUIRING, exactly as the pure rule reads
    // it — only an explicit opt-out, or no location at all, means "no backlog
    // is possible here".
    const canHaveBacklog = row.locationId !== null && (row.requiresHandover ?? true)

    return {
      productId: row.productId,
      product: row.product,
      location: row.location ?? null,
      sold: Number(row.units) || 0,
      outstanding: canHaveBacklog ? (outstandingByProduct.get(row.productId) ?? 0) : null
    }
  })
}
