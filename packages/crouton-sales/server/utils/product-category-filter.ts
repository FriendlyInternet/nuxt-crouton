/**
 * Product / category filter for the Data pane (#2146).
 *
 * A product matches when its id is in `productIds`, OR its category is in
 * `categoryIds` — a category selection is shorthand for "all its products".
 * Mirrors `personnelConditionOn()`'s contract (`personnel-condition.ts`):
 * `undefined` when no filter is set, safe to drop straight into `and(...)`,
 * which ignores undefined args — so every endpoint's existing WHERE
 * composition inherits this filter without special-casing the empty case.
 *
 * Takes the product-id / category-id COLUMNS rather than a table, so it works
 * whether the caller already has `salesProducts` joined in (product-day-matrix,
 * per-product-totals) or needs to join it in for this filter alone
 * (revenue-by-day, top-products, which previously had no reason to touch
 * `salesProducts` at all).
 */
import { inArray, or, type AnyColumn, type SQL } from 'drizzle-orm'

export interface ProductCategoryFilter {
  productIds?: unknown
  categoryIds?: unknown
}

/**
 * A query-string id list, as either a comma-separated string (`?productIds=a,b`)
 * or an array (repeated `?productIds=a&productIds=b`) — coerced to a clean
 * array of non-empty string ids.
 */
function toIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean)
  if (typeof value === 'string' && value) return value.split(',').map(v => v.trim()).filter(Boolean)
  return []
}

/**
 * Drizzle condition for `productIdColumn IN productIds OR categoryIdColumn IN
 * categoryIds`, or `undefined` when both filters are empty/omitted.
 */
export function productCategoryCondition(
  productIdColumn: AnyColumn,
  categoryIdColumn: AnyColumn,
  filter: ProductCategoryFilter
): SQL | undefined {
  const productIds = toIdList(filter.productIds)
  const categoryIds = toIdList(filter.categoryIds)

  if (!productIds.length && !categoryIds.length) return undefined

  const conditions: SQL[] = []
  if (productIds.length) conditions.push(inArray(productIdColumn, productIds))
  if (categoryIds.length) conditions.push(inArray(categoryIdColumn, categoryIds))

  return or(...conditions)
}
