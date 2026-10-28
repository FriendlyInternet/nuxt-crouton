import { describe, it, expect } from 'vitest'
import { canonicalFormName, canonicalDetailName, resolveFormChain } from '../form-resolver'

const has = (...names: string[]) => (n: string) => names.includes(n)

describe('canonical names', () => {
  it('upper-cases the first letter of the collection key', () => {
    expect(canonicalFormName('bookingsLocations')).toBe('BookingsLocationsForm')
    expect(canonicalDetailName('shopProducts')).toBe('ShopProductsDetail')
  })
})

describe('resolveFormChain', () => {
  it('delete never loads a form', () => {
    expect(resolveFormChain('shopProducts', 'delete', has('LazyShopProductsForm'))).toEqual({ kind: 'delete' })
  })

  it('create/update use the lazy form', () => {
    expect(resolveFormChain('shopProducts', 'update', has('LazyShopProductsForm')))
      .toEqual({ kind: 'component', name: 'LazyShopProductsForm' })
  })

  it('view prefers the per-collection detail', () => {
    const r = resolveFormChain('shopProducts', 'view', has('LazyShopProductsDetail', 'CroutonDetail', 'LazyShopProductsForm'))
    expect(r).toEqual({ kind: 'component', name: 'LazyShopProductsDetail' })
  })

  it('view falls back to CroutonDetail, flagged generic', () => {
    const r = resolveFormChain('shopProducts', 'view', has('CroutonDetail', 'LazyShopProductsForm'))
    expect(r).toEqual({ kind: 'component', name: 'CroutonDetail', generic: true })
  })

  it('view falls back to the form when no detail exists', () => {
    expect(resolveFormChain('shopProducts', 'view', has('LazyShopProductsForm')))
      .toEqual({ kind: 'component', name: 'LazyShopProductsForm' })
  })

  it('returns none when nothing is registered (e.g. pagesPages)', () => {
    expect(resolveFormChain('pagesPages', 'update', has())).toEqual({ kind: 'none' })
    expect(resolveFormChain(undefined, 'update', has('LazyForm'))).toEqual({ kind: 'none' })
  })
})
