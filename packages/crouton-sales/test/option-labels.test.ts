import { describe, it, expect } from 'vitest'
import { resolvePrintOptionLabels } from '../server/utils/option-labels'

const OPTIONS = [
  { id: 'opt_a', label: 'Extra cheese' },
  { id: 'opt_b', label: 'No onion' }
]

describe('resolvePrintOptionLabels', () => {
  it('maps an array of known ids to their labels, in order', () => {
    expect(resolvePrintOptionLabels(['opt_b', 'opt_a'], OPTIONS)).toEqual(['No onion', 'Extra cheese'])
  })

  it('accepts a single id string', () => {
    expect(resolvePrintOptionLabels('opt_a', OPTIONS)).toEqual(['Extra cheese'])
  })

  it('DROPS unknown ids (never renders a raw id on paper)', () => {
    expect(resolvePrintOptionLabels(['opt_a', 'opt_missing'], OPTIONS)).toEqual(['Extra cheese'])
  })

  it('returns [] when the product has no options', () => {
    expect(resolvePrintOptionLabels(['opt_a'], [])).toEqual([])
    expect(resolvePrintOptionLabels(['opt_a'], null)).toEqual([])
  })

  it('returns [] for empty / non-id-shaped input', () => {
    expect(resolvePrintOptionLabels(null, OPTIONS)).toEqual([])
    expect(resolvePrintOptionLabels(undefined, OPTIONS)).toEqual([])
    // Object-form selectedOptions is not an id list on this path → dropped.
    expect(resolvePrintOptionLabels({ some: 'thing' }, OPTIONS)).toEqual([])
  })
})
