import { describe, it, expect } from 'vitest'
import { buildProductDayMatrix, type ProductDayRow } from '../server/utils/product-day-matrix'

// Shorthand row builder: sensible defaults, override what the case is about.
function row(overrides: Partial<ProductDayRow>): ProductDayRow {
  return {
    date: '2026-08-01',
    product: 'Pils',
    category: 'Drank',
    categoryOrder: 0,
    price: 2.5,
    units: 1,
    revenue: 2.5,
    ...overrides
  }
}

describe('buildProductDayMatrix', () => {
  it('groups products per category by displayOrder, units-desc within a category', () => {
    const matrix = buildProductDayMatrix([
      // Deliberately fed in the old best-seller-first order across categories.
      row({ product: 'Pils', category: 'Drank', categoryOrder: 1, units: 100 }),
      row({ product: 'IJsje', category: 'Dessert', categoryOrder: 2, units: 80 }),
      row({ product: 'Frietjes', category: 'Eten', categoryOrder: 0, units: 60 }),
      row({ product: 'Cola', category: 'Drank', categoryOrder: 1, units: 40 }),
      row({ product: 'Burger', category: 'Eten', categoryOrder: 0, units: 90 })
    ])

    expect(matrix.products.map(p => p.product)).toEqual([
      'Burger', 'Frietjes', // Eten (order 0), units desc
      'Pils', 'Cola', // Drank (order 1), units desc
      'IJsje' // Dessert (order 2)
    ])
    expect(matrix.products.map(p => p.category)).toEqual([
      'Eten', 'Eten', 'Drank', 'Drank', 'Dessert'
    ])
  })

  it('sorts equal-displayOrder categories by title and puts uncategorized products last', () => {
    const matrix = buildProductDayMatrix([
      row({ product: 'Mystery', category: null, categoryOrder: null, units: 999 }),
      row({ product: 'Soep', category: 'Zeten', categoryOrder: 0, units: 5 }),
      row({ product: 'Wafel', category: 'Achteraf', categoryOrder: 0, units: 5 })
    ])

    expect(matrix.products.map(p => p.product)).toEqual(['Wafel', 'Soep', 'Mystery'])
    expect(matrix.products[2]!.category).toBeNull()
  })

  it('carries the unit price on each product row', () => {
    const matrix = buildProductDayMatrix([
      row({ product: 'Pils', price: 2.5 }),
      row({ product: 'Frietjes', category: 'Eten', price: 4 })
    ])

    const byProduct = Object.fromEntries(matrix.products.map(p => [p.product, p.price]))
    expect(byProduct).toEqual({ Pils: 2.5, Frietjes: 4 })
  })

  it('keeps the same product title in two categories as two separate rows', () => {
    const matrix = buildProductDayMatrix([
      row({ product: 'Special', category: 'Eten', categoryOrder: 0, units: 3, revenue: 12 }),
      row({ product: 'Special', category: 'Dessert', categoryOrder: 1, units: 7, revenue: 28 })
    ])

    expect(matrix.products).toHaveLength(2)
    expect(matrix.products.map(p => p.category)).toEqual(['Eten', 'Dessert'])
    expect(matrix.grandTotal).toEqual({ units: 10, revenue: 40 })
  })

  it('pivots per-day cells and sums day, product and grand totals', () => {
    const matrix = buildProductDayMatrix([
      row({ date: '2026-08-01', product: 'Pils', units: 10, revenue: 25 }),
      row({ date: '2026-08-02', product: 'Pils', units: 4, revenue: 10 }),
      row({ date: '2026-08-02', product: 'Cola', units: 2, revenue: 5 })
    ])

    expect(matrix.days).toEqual(['2026-08-01', '2026-08-02'])
    const pils = matrix.products.find(p => p.product === 'Pils')!
    expect(pils.units).toEqual({ '2026-08-01': 10, '2026-08-02': 4 })
    expect(pils.totalUnits).toBe(14)
    expect(pils.totalRevenue).toBe(35)
    expect(matrix.dayTotals['2026-08-02']).toEqual({ units: 6, revenue: 15 })
    expect(matrix.grandTotal).toEqual({ units: 16, revenue: 40 })
  })

  it('treats non-numeric aggregates as zero (SQLite sum can yield null)', () => {
    const matrix = buildProductDayMatrix([
      row({ units: Number.NaN as number, revenue: null as unknown as number })
    ])
    expect(matrix.grandTotal).toEqual({ units: 0, revenue: 0 })
  })
})
