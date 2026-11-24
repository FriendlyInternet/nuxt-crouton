import { describe, expect, it } from 'vitest'
import { itemUnitPrice } from '../shared/utils/item-price'

const product = {
  price: 3,
  options: [
    { id: 'big', priceModifier: 1.5 },
    { id: 'sauce', priceModifier: 0.5 },
    { id: 'free' }
  ]
}

describe('itemUnitPrice — one price for the till and the server (#4481)', () => {
  // covers: T1
  it('no options is the product price', () => {
    expect(itemUnitPrice(product)).toBe(3)
    expect(itemUnitPrice(product, null)).toBe(3)
  })

  // covers: T1
  it('one option id adds its modifier', () => {
    expect(itemUnitPrice(product, 'big')).toBe(4.5)
  })

  // covers: T1
  it('a list of ids adds every modifier', () => {
    expect(itemUnitPrice(product, ['big', 'sauce'])).toBe(5)
  })

  // covers: T1
  it('an unknown option id or one without a modifier adds nothing', () => {
    expect(itemUnitPrice(product, 'nope')).toBe(3)
    expect(itemUnitPrice(product, ['nope', 'free'])).toBe(3)
  })

  // covers: T1
  it('an object as selectedOptions, or non-string ids in a list, count as no options', () => {
    expect(itemUnitPrice(product, { big: true } as any)).toBe(3)
    expect(itemUnitPrice(product, [{ id: 'big' }, 7] as any)).toBe(3)
  })

  // covers: T1
  it('a string price and missing/null options still work', () => {
    expect(itemUnitPrice({ price: '2.5' }, 'big')).toBe(2.5)
    expect(itemUnitPrice({ price: '2.5', options: null }, ['big'])).toBe(2.5)
    expect(itemUnitPrice({ price: '2.5', options: product.options }, 'big')).toBe(4)
  })
})
