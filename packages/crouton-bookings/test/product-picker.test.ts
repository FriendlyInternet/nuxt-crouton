import { describe, it, expect } from 'vitest'
import { showProductPicker } from '../app/utils/product-picker'

// #4109 S8: the picker shows only with 2+ listed products active in the team
const listed = (...ids: string[]) => ({ products: ids.map(product => ({ product, stock: 1 })) })

describe('showProductPicker (#4109)', () => {
  it('two listed, both active → true', () => {
    expect(showProductPicker(listed('P', 'Q'), [{ id: 'P', active: true }, { id: 'Q' }])).toBe(true)
  })
  it('two listed, one inactive → false', () => {
    expect(showProductPicker(listed('P', 'Q'), [{ id: 'P', active: true }, { id: 'Q', active: false }])).toBe(false)
  })
  it('one listed → false', () => {
    expect(showProductPicker(listed('P'), [{ id: 'P', active: true }])).toBe(false)
  })
  it('none listed → false', () => {
    expect(showProductPicker(listed(), [{ id: 'P', active: true }])).toBe(false)
  })
  it('reads the raw JSON string the column holds', () => {
    expect(showProductPicker({ products: JSON.stringify([{ product: 'P', stock: 1 }, { product: 'Q', stock: 1 }]) }, [{ id: 'P' }, { id: 'Q' }])).toBe(true)
  })
})
