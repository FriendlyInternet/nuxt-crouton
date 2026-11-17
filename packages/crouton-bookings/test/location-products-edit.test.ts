/**
 * #4087 — the location form edits a location's products list through these pure rules.
 */
import { describe, it, expect } from 'vitest'
import {
  addProduct,
  clampStock,
  normaliseProducts,
  pickable,
  removeProduct,
  rowsFor,
  setStock
} from '../app/utils/location-products-edit'

describe('location products editing (#4087)', () => {
  it('F1 — adding a product appends it with its stock', () => {
    const before = [{ product: 'court', stock: 2 }]
    const after = addProduct(before, 'bike', 3)
    expect(after).toEqual([{ product: 'court', stock: 2 }, { product: 'bike', stock: 3 }])
    expect(before).toEqual([{ product: 'court', stock: 2 }])
    expect(addProduct(null, 'bike', 1)).toEqual([{ product: 'bike', stock: 1 }])
  })

  it('F2 — a product already listed is not added twice, and its stock is kept', () => {
    const list = [{ product: 'court', stock: 2 }]
    const after = addProduct(list, 'court', 9)
    expect(after).toEqual([{ product: 'court', stock: 2 }])
    expect(after).not.toBe(list)
  })

  it('F3 — stock is a whole number of at least 1', () => {
    expect(clampStock(2.5)).toBe(2)
    expect(clampStock(0)).toBe(1)
    expect(clampStock(-3)).toBe(1)
    expect(clampStock('')).toBe(1)
    expect(clampStock(null)).toBe(1)
    expect(clampStock(Number.NaN)).toBe(1)
    expect(clampStock('4')).toBe(4)
    expect(setStock([{ product: 'a', stock: 1 }, { product: 'b', stock: 1 }], 'b', 7.9))
      .toEqual([{ product: 'a', stock: 1 }, { product: 'b', stock: 7 }])
    expect(setStock([{ product: 'a', stock: 3 }], 'a', 0)).toEqual([{ product: 'a', stock: 1 }])
  })

  it('F4 — removing the last row gives [], never null', () => {
    expect(removeProduct([{ product: 'a', stock: 1 }, { product: 'b', stock: 2 }], 'a'))
      .toEqual([{ product: 'b', stock: 2 }])
    expect(removeProduct([{ product: 'a', stock: 1 }], 'a')).toEqual([])
    expect(removeProduct(null, 'a')).toEqual([])
  })

  it('F5 — the picker lists only active, unlisted team products, in order', () => {
    const team = [
      { id: 'c', active: true },
      { id: 'a' },
      { id: 'off', active: false },
      { id: 'b', active: null },
      { id: 'listed', active: true }
    ]
    expect(pickable(team, [{ product: 'listed', stock: 1 }]).map(p => p.id)).toEqual(['c', 'a', 'b'])
    expect(pickable(null, null)).toEqual([])
  })

  it('F6 — listed rows keep inactive or removed products, flagged', () => {
    const team = [{ id: 'on', active: true }, { id: 'off', active: false }]
    const rows = rowsFor([
      { product: 'on', stock: 1 },
      { product: 'off', stock: 2 },
      { product: 'gone', stock: 3 }
    ], team)
    expect(rows.map(r => [r.product, r.stock, r.inactive, r.removed])).toEqual([
      ['on', 1, false, false],
      ['off', 2, true, false],
      ['gone', 3, false, true]
    ])
    expect(rows[0]!.teamProduct).toBe(team[0])
    expect(rows[2]!.teamProduct).toBeUndefined()
  })

  it('normalises a stored value: JSON string → list, null stays null', () => {
    expect(normaliseProducts('[{"product":"court","stock":2}]')).toEqual([{ product: 'court', stock: 2 }])
    expect(normaliseProducts([{ product: 'court', stock: 2 }])).toEqual([{ product: 'court', stock: 2 }])
    expect(normaliseProducts(null)).toBeNull()
    expect(normaliseProducts(undefined)).toBeNull()
    expect(normaliseProducts([])).toEqual([])
  })
})
