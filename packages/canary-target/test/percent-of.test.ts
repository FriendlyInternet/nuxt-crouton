import { describe, it, expect } from 'vitest'
import { percentOf } from '../src/index'

describe('percentOf', () => {
  it('computes an ordinary ratio', () => {
    expect(percentOf(25, 200)).toBe(12.5)
  })

  it('returns 0 for a zero numerator', () => {
    expect(percentOf(0, 200)).toBe(0)
  })

  it('throws rather than returning Infinity/NaN for a zero total', () => {
    expect(() => percentOf(5, 0)).toThrow(RangeError)
  })

  it('rounds to the requested precision', () => {
    expect(percentOf(1, 3, 2)).toBe(33.33)
  })

  it('defaults to 1 decimal place of precision', () => {
    expect(percentOf(1, 3)).toBe(33.3)
  })

  it('returns a negative percentage without clamping', () => {
    expect(percentOf(-25, 200)).toBe(-12.5)
  })
})
