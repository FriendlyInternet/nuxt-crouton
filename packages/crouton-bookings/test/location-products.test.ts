import { describe, it, expect } from 'vitest'
import { defaultLocationProduct } from '../server/utils/location-products'

// #4044 — a location saved without products gets one product of its own, with
// the ids/titles of step 2's migration (`*_products_per_location.sql`). Its stock
// is 1 (#4172).
const base = { id: 'L1', teamId: 't1', owner: 'o1', title: 'Kayak Rental', createdBy: 'c1', updatedBy: 'u1', createdAt: new Date(1000), updatedAt: new Date(2000) }

describe('defaultLocationProduct (#4044)', () => {
  // covers: T1
  it('H1 location: id loc-<id>, stock 1, translations with an en fallback, createdBy/updatedBy copied', () => {
    const own = defaultLocationProduct({ ...base, translations: { nl: { title: 'Kajakverhuur' } } } as any)
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 1 }])
    expect(own.catalogProduct).toMatchObject({
      id: 'loc-L1', teamId: 't1', owner: 'o1', title: 'Kayak Rental', active: true, order: 0,
      createdBy: 'c1', updatedBy: 'u1', createdAt: new Date(1000), updatedAt: new Date(2000),
    })
    expect(own.catalogProduct.translations).toEqual({ nl: { title: 'Kajakverhuur' }, en: { title: 'Kayak Rental' } })
  })

  // covers: T1
  it('H4 slot location: stock 1', () => {
    const own = defaultLocationProduct({ ...base, slots: JSON.stringify([{ id: 'a' }, { id: 'b' }]) } as any)
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 1 }])
  })
})
