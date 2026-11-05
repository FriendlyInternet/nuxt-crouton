import { describe, it, expect } from 'vitest'
import { swipeDirection, lockAxis } from '../app/utils/swipe'

describe('swipeDirection (#2485)', () => {
  it('swipe left → next', () => expect(swipeDirection(-80, 5)).toBe('next'))
  it('swipe right → prev', () => expect(swipeDirection(80, -5)).toBe('prev'))
  it('short drag → null', () => expect(swipeDirection(-30, 0)).toBeNull())
  it('mostly vertical drag → null', () => expect(swipeDirection(-60, 90)).toBeNull())
  it('diagonal scroll → null', () => expect(swipeDirection(60, 40)).toBeNull())
})

describe('lockAxis (#2515)', () => {
  it('tiny movement → undecided', () => expect(lockAxis(4, 3)).toBeNull())
  it('mostly horizontal → x', () => expect(lockAxis(-20, 5)).toBe('x'))
  it('mostly vertical → y', () => expect(lockAxis(5, 30)).toBe('y'))
})
