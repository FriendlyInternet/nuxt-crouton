import { describe, it, expect } from 'vitest'
import { swipeDirection } from '../app/utils/swipe'

describe('swipeDirection (#2485)', () => {
  it('swipe left → next', () => expect(swipeDirection(-80, 5)).toBe('next'))
  it('swipe right → prev', () => expect(swipeDirection(80, -5)).toBe('prev'))
  it('short drag → null', () => expect(swipeDirection(-30, 0)).toBeNull())
  it('mostly vertical drag → null', () => expect(swipeDirection(-60, 90)).toBeNull())
  it('diagonal scroll → null', () => expect(swipeDirection(60, 40)).toBeNull())
})
