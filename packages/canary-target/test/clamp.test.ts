/**
 * The reference pairing: a pure function and the test that pins it (#1878).
 *
 * A canary run is asked to add a second function alongside `clamp` AND its test. This file is
 * what "and its test" is supposed to look like, so the ask is concrete rather than abstract.
 */
import { describe, it, expect } from 'vitest'
import { clamp } from '../src/index'

describe('clamp', () => {
  it('returns the value unchanged when it is already in range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('raises a value below the floor', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
  })

  it('lowers a value above the ceiling', () => {
    expect(clamp(42, 0, 10)).toBe(10)
  })

  it('is inclusive at both bounds', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('collapses to the single value when min === max', () => {
    expect(clamp(99, 7, 7)).toBe(7)
  })

  it('throws rather than silently inverting an impossible range', () => {
    // Math.min(Math.max(…)) would quietly return `min` here, which reads as a valid answer.
    // An impossible range is a caller bug, so it must be loud.
    expect(() => clamp(5, 10, 0)).toThrow(RangeError)
  })
})
