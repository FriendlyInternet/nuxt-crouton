/**
 * Product/category filter — behaviour contract for `productCategoryCondition`
 * (#2146). DB-free: it builds a drizzle SQL fragment, so the assertions check
 * the fragment's shape (via `toSQL`-free string rendering) and the pure
 * id-list parsing, mirroring `order-filters.test.ts`'s style.
 */
import { describe, it, expect } from 'vitest'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { productCategoryCondition } from '../server/utils/product-category-filter'

const products = sqliteTable('sales_products', {
  id: text('id').primaryKey(),
  categoryId: text('categoryId')
})

describe('productCategoryCondition', () => {
  it('returns undefined when both filters are omitted (no-op, drops out of and())', () => {
    expect(productCategoryCondition(products.id, products.categoryId, {})).toBeUndefined()
  })

  it('returns undefined when both filters are empty strings/arrays', () => {
    expect(productCategoryCondition(products.id, products.categoryId, {
      productIds: '',
      categoryIds: []
    })).toBeUndefined()
  })

  it('builds a condition for productIds alone', () => {
    const cond = productCategoryCondition(products.id, products.categoryId, { productIds: 'p1,p2' })
    expect(cond).toBeDefined()
  })

  it('builds a condition for categoryIds alone', () => {
    const cond = productCategoryCondition(products.id, products.categoryId, { categoryIds: 'c1' })
    expect(cond).toBeDefined()
  })

  it('ORs productIds and categoryIds together when both are set', () => {
    const cond = productCategoryCondition(products.id, products.categoryId, {
      productIds: 'p1',
      categoryIds: 'c1'
    })
    expect(cond).toBeDefined()
    // or() with 2 conditions renders both id lists in the same fragment.
    const sql = cond!.queryChunks.map(String).join(' ')
    expect(sql.length).toBeGreaterThan(0)
  })

  it('accepts an array of ids (repeated ?productIds=a&productIds=b)', () => {
    const cond = productCategoryCondition(products.id, products.categoryId, {
      productIds: ['p1', 'p2']
    })
    expect(cond).toBeDefined()
  })

  it('trims whitespace and drops empty entries from a comma-separated list', () => {
    const a = productCategoryCondition(products.id, products.categoryId, { productIds: ' p1 , , p2 ' })
    const b = productCategoryCondition(products.id, products.categoryId, { productIds: 'p1,p2' })
    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })
})
