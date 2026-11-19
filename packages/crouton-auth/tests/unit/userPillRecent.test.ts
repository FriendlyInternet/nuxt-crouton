import { describe, it, expect } from 'vitest'
import { buildRecentMenuItem } from '../../app/utils/userPillRecent'

const entryA = { label: 'Saved booking', icon: 'i-lucide-check' }
const entryB = { label: 'Deleted item', icon: 'i-lucide-trash' }
const seeAll = { label: 'See all activity', icon: 'i-lucide-list', to: '/admin/t/activity' }

describe('buildRecentMenuItem', () => {
  // covers: T1
  it('folds entries + see-all into ONE item, entries first then see-all', () => {
    const item = buildRecentMenuItem({ label: 'Recent', entries: [entryA, entryB], seeAll })
    expect(item).not.toBeNull()
    expect(item!.children).toEqual([entryA, entryB, seeAll])
  })

  // covers: T2
  it('returns null when there are no entries and no see-all', () => {
    expect(buildRecentMenuItem({ label: 'Recent', entries: [], seeAll: null })).toBeNull()
    expect(buildRecentMenuItem({ label: 'Recent', entries: [] })).toBeNull()
  })

  // covers: T3
  it('handles see-all only and entries only', () => {
    expect(buildRecentMenuItem({ label: 'Recent', entries: [], seeAll })!.children).toEqual([seeAll])
    expect(buildRecentMenuItem({ label: 'Recent', entries: [entryA], seeAll: null })!.children).toEqual([entryA])
  })

  // covers: T4
  it('carries the label, the history icon and the recent slot', () => {
    const item = buildRecentMenuItem({ label: 'Récent', entries: [entryA] })!
    expect(item.label).toBe('Récent')
    expect(item.icon).toBe('i-lucide-history')
    expect(item.slot).toBe('recent')
  })
})
