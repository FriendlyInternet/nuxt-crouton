import { describe, it, expect } from 'vitest'
import { defaultLocationProduct } from '../server/utils/location-products'

// #4044 — a location saved without products gets one product of its own, by the
// same rule step 2's migration (`*_products_per_location.sql`) used for old rows.
const base = { id: 'L1', teamId: 't1', owner: 'o1', title: 'Kayak Rental', createdBy: 'c1', updatedBy: 'u1', createdAt: new Date(1000), updatedAt: new Date(2000) }

describe('defaultLocationProduct (#4044)', () => {
  // covers: T1
  it('H1 inventory location: id loc-<id>, stock = quantity, translations with an en fallback, createdBy/updatedBy copied', () => {
    const own = defaultLocationProduct({ ...base, inventoryMode: 1, quantity: 8, translations: { nl: { title: 'Kajakverhuur' } } })
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 8 }])
    expect(own.catalogProduct).toMatchObject({
      id: 'loc-L1', teamId: 't1', owner: 'o1', title: 'Kayak Rental', active: true, order: 0,
      createdBy: 'c1', updatedBy: 'u1', createdAt: new Date(1000), updatedAt: new Date(2000),
    })
    expect(own.catalogProduct.translations).toEqual({ nl: { title: 'Kajakverhuur' }, en: { title: 'Kayak Rental' } })
  })

  // covers: T1
  it('H2 slot location: stock = the highest slot capacity', () => {
    const own = defaultLocationProduct({ ...base, inventoryMode: 0, slots: [{ id: 'a', capacity: 1 }, { id: 'b', capacity: 1 }, { id: 'c', capacity: 2 }] })
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 2 }])
  })

  // covers: T1
  it('H3 inventory location with quantity 0: stock is at least 1', () => {
    const own = defaultLocationProduct({ ...base, inventoryMode: 1, quantity: 0 })
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 1 }])
  })

  // covers: T1
  it('H4 slots without capacity: stock 1', () => {
    const own = defaultLocationProduct({ ...base, inventoryMode: false, slots: JSON.stringify([{ id: 'a' }, { id: 'b' }]) })
    expect(own.products).toEqual([{ product: 'loc-L1', stock: 1 }])
  })
})
