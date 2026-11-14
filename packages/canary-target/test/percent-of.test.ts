/**
 * The six cases agreed on #1932 for `percentOf` — one `it` per case.
 */
import { describe, it, expect } from 'vitest'
import { percentOf } from '../src/index'

describe('percentOf', () => {
  it('computes an ordinary ratio', () => {
    expect(percentOf(25, 200)).toBe(12.5)
  })

  it('returns 0 for a zero numerator', () => {
    expect(percentOf(0, 200)).toBe(0)
  })

  it('throws on a total of zero instead of returning Infinity/NaN', () => {
    expect(() => percentOf(5, 0)).toThrow(RangeError)
    expect(() => percentOf(0, 0)).toThrow(RangeError)
  })

  it('rounds to the given precision', () => {
    expect(percentOf(1, 3, 2)).toBe(33.33)
  })

  it('defaults to 1 decimal place', () => {
    expect(percentOf(1, 3)).toBe(33.3)
  })

  it('returns a negative percentage for a negative value without clamping', () => {
    expect(percentOf(-50, 200)).toBe(-25)
  })
})
