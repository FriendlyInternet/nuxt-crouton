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

  // #4236 — the fallback title goes to the app's default language, not always `en`.
  it('F2 a fr-only location with locale fr gets { fr } and no en', () => {
    const own = defaultLocationProduct({ ...base, title: 'Location de kayaks', translations: { fr: { title: 'Location de kayaks' } } } as any, 'fr')
    expect(own.catalogProduct.translations).toEqual({ fr: { title: 'Location de kayaks' } })
  })

  it('F2 an nl-only location with locale en still gets the en fallback', () => {
    const own = defaultLocationProduct({ ...base, translations: { nl: { title: 'Kajakverhuur' } } } as any, 'en')
    expect(own.catalogProduct.translations).toEqual({ nl: { title: 'Kajakverhuur' }, en: { title: 'Kayak Rental' } })
  })

  it('F2 a location missing the default language gets it from the main title', () => {
    const own = defaultLocationProduct({ ...base, translations: { en: { title: 'Kayak Rental' } } } as any, 'fr')
    expect(own.catalogProduct.translations).toEqual({ en: { title: 'Kayak Rental' }, fr: { title: 'Kayak Rental' } })
  })
})
