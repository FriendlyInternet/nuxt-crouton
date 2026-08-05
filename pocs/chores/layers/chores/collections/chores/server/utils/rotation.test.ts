/**
 * Round-robin rotation logic (#1937). Test-first per the operating contract:
 * this is hand-written app logic (pocs/ exempts the Test Sign-Off gate itself,
 * but the case coverage still gets written and run here rather than skipped).
 */
import { describe, it, expect } from 'vitest'
import { getNextAssignee } from './rotation'

describe('getNextAssignee', () => {
  const order = ['alice', 'bob', 'carol']

  it('advances to the next member in order', () => {
    expect(getNextAssignee('alice', order)).toBe('bob')
    expect(getNextAssignee('bob', order)).toBe('carol')
  })

  it('wraps around after the last member', () => {
    expect(getNextAssignee('carol', order)).toBe('alice')
  })

  it('falls back to the first member when the current assignee is unknown', () => {
    expect(getNextAssignee('unknown-id', order)).toBe('alice')
  })

  it('returns the current assignee unchanged when there is no rotation order', () => {
    expect(getNextAssignee('alice', [])).toBe('alice')
  })
})
