/**
 * Product × Day matrix shaper (#2126)
 *
 * Pure pivot for the product-day-matrix chart endpoint: flat per-(day ×
 * product) aggregate rows in, the salesProductMatrixBlock table shape out.
 *
 * Ordering is the point (the kassa owner's Excel ask): products are grouped
 * per CATEGORY — category displayOrder, then category title — with units-desc
 * inside a group. Products without a category form a trailing group rather
 * than disappearing. Each product carries its category title and unit price
 * so the CSV can put the price beside the product name.
 */

export interface ProductDayRow {
  date: string
  product: string
  /** Category title (null when the product has no category). */
  category: string | null
  /** Category displayOrder (null when the product has no category). */
  categoryOrder: number | null
  /** Current unit price of the product. */
  price: number | null
  units: number
  revenue: number
}

export interface MatrixProduct {
  product: string
  category: string | null
  price: number | null
  units: Record<string, number>
  revenue: Record<string, number>
  totalUnits: number
  totalRevenue: number
}

export interface ProductDayMatrix {
  days: string[]
  products: MatrixProduct[]
  dayTotals: Record<string, { units: number, revenue: number }>
  grandTotal: { units: number, revenue: number }
}

export function buildProductDayMatrix(rows: ProductDayRow[]): ProductDayMatrix {
  const days = [...new Set(rows.map(r => r.date))].sort()

  interface Acc extends MatrixProduct { categoryOrder: number | null }
  // Keyed by category + product: the same product title under two categories
  // must stay two rows, or the category grouping would merge across groups.
  const productMap = new Map<string, Acc>()
  const dayTotals: Record<string, { units: number, revenue: number }> = {}
  let grandUnits = 0
  let grandRevenue = 0

  for (const r of rows) {
    const u = Number(r.units) || 0
    const rev = Number(r.revenue) || 0

    const key = `${r.category ?? ''}\u0000${r.product}`
    if (!productMap.has(key)) {
      productMap.set(key, {
        product: r.product,
        category: r.category ?? null,
        categoryOrder: r.categoryOrder ?? null,
        price: r.price ?? null,
        units: {},
        revenue: {},
        totalUnits: 0,
        totalRevenue: 0
      })
    }
    const p = productMap.get(key)!
    p.units[r.date] = u
    p.revenue[r.date] = rev
    p.totalUnits += u
    p.totalRevenue += rev

    if (!dayTotals[r.date]) dayTotals[r.date] = { units: 0, revenue: 0 }
    dayTotals[r.date]!.units += u
    dayTotals[r.date]!.revenue += rev

    grandUnits += u
    grandRevenue += rev
  }

  const products = [...productMap.values()]
    .sort((a, b) => {
      // Uncategorized last, then category displayOrder, then category title.
      if ((a.category === null) !== (b.category === null)) return a.category === null ? 1 : -1
      const orderDiff = (a.categoryOrder ?? 0) - (b.categoryOrder ?? 0)
      if (orderDiff !== 0) return orderDiff
      const catDiff = (a.category ?? '').localeCompare(b.category ?? '')
      if (catDiff !== 0) return catDiff
      // Within a category: best sellers first, title as a stable tie-break.
      if (b.totalUnits !== a.totalUnits) return b.totalUnits - a.totalUnits
      return a.product.localeCompare(b.product)
    })
    .map(({ categoryOrder, ...p }) => p)

  return {
    days,
    products,
    dayTotals,
    grandTotal: { units: grandUnits, revenue: grandRevenue }
  }
}
