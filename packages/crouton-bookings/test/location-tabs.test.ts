/**
 * #4471 — the location tab row ⇄ `filters.locations` mapping, and the one-or-none
 * toggle the map pin and the Locations block share.
 */
import { describe, it, expect } from 'vitest'
import { ALL_LOCATIONS, locationsFor, pickOne, tabValueFor } from '../app/utils/location-tabs'

describe('location tabs (#4471)', () => {
  // covers: T1
  it('filter → tab value: none is All (null), otherwise the first id', () => {
    expect(tabValueFor([])).toBeNull()
    expect(tabValueFor(['a'])).toBe('a')
    expect(tabValueFor(['a', 'b'])).toBe('a')
  })

  // covers: T1
  it('tab value → filter: All / null / undefined clear it, an id selects just that one', () => {
    expect(locationsFor(null)).toEqual([])
    expect(locationsFor(ALL_LOCATIONS)).toEqual([])
    expect(locationsFor(undefined)).toEqual([])
    expect(locationsFor('b')).toEqual(['b'])
  })

  // covers: T1
  it('pickOne: replaces, clears on the same one, never merges', () => {
    expect(pickOne([], 'a')).toEqual(['a'])
    expect(pickOne(['a'], 'b')).toEqual(['b'])
    expect(pickOne(['b'], 'b')).toEqual([])
    expect(pickOne(['a', 'b'], 'a')).toEqual(['a'])
  })
})
