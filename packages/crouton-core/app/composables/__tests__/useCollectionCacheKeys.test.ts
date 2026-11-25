import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

let mockRoute: { path: string; params?: Record<string, any> } = {
  path: '/admin/team-a/products',
  params: { team: 'team-a' }
}
let mockUseTeam: (() => { currentTeam: any }) | null = null
const useTeamCalls = vi.fn()
let mockPayloadData: Record<string, any> = {}
const mockRefreshNuxtData = vi.fn()

vi.stubGlobal('computed', computed)
vi.stubGlobal('useRoute', () => mockRoute)
vi.stubGlobal('useTeam', () => {
  useTeamCalls()
  if (mockUseTeam) return mockUseTeam()
  throw new Error('useTeam not available')
})
vi.stubGlobal('useNuxtApp', () => ({ payload: { data: mockPayloadData } }))
vi.stubGlobal('refreshNuxtData', mockRefreshNuxtData)

import { useCollectionCacheKeys } from '../useCollectionCacheKeys'

describe('useCollectionCacheKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoute = { path: '/admin/team-a/products', params: { team: 'team-a' } }
    mockUseTeam = () => ({ currentTeam: ref({ id: 'team-a' }) })
    mockPayloadData = {}
  })

  // covers: T1
  describe('key shapes', () => {
    it('builds the item key with the team', () => {
      const { itemKey } = useCollectionCacheKeys('products')
      expect(itemKey('p1')).toBe('collection-item:products:team-a:p1')
    })

    it('builds the list key with the team and {} for no query', () => {
      const { listKey } = useCollectionCacheKeys('products')
      expect(listKey()).toBe('collection:products:team-a:{}')
    })

    it('builds the list key with the query as JSON', () => {
      const { listKey } = useCollectionCacheKeys('products')
      expect(listKey({ eventId: 'e1' })).toBe('collection:products:team-a:{"eventId":"e1"}')
    })

    it('uses super-admin on a /super-admin/ route', () => {
      mockRoute = { path: '/super-admin/products', params: {} }
      const { teamPart, isSuperAdmin, listKey, itemKey } = useCollectionCacheKeys('products')
      expect(isSuperAdmin.value).toBe(true)
      expect(teamPart.value).toBe('super-admin')
      expect(listKey()).toBe('collection:products:super-admin:{}')
      expect(itemKey('p1')).toBe('collection-item:products:super-admin:p1')
    })

    it('falls back to the route param when useTeam throws', () => {
      mockUseTeam = null
      mockRoute = { path: '/admin/acme/products', params: { team: 'acme' } }
      const { listKey, itemKey } = useCollectionCacheKeys('products')
      expect(listKey()).toBe('collection:products:acme:{}')
      expect(itemKey('p1')).toBe('collection-item:products:acme:p1')
    })
  })

  // covers: T2
  describe('team switch', () => {
    it('moves list and item keys to the new team without calling useTeam again', () => {
      const currentTeam = ref({ id: 'team-a' })
      mockUseTeam = () => ({ currentTeam })

      const { listKey, itemKey } = useCollectionCacheKeys('products')
      expect(listKey()).toBe('collection:products:team-a:{}')

      currentTeam.value = { id: 'team-b' }

      expect(listKey()).toBe('collection:products:team-b:{}')
      expect(itemKey('p1')).toBe('collection-item:products:team-b:p1')
      expect(useTeamCalls).toHaveBeenCalledTimes(1)
    })
  })

  describe('refreshers', () => {
    beforeEach(() => {
      mockPayloadData = {
        'collection:products:team-a:{}': [],
        'collection:products:team-a:{"eventId":"e1"}': [],
        'collection:products:team-b:{}': [],
        'collection:productsArchive:team-a:{}': [],
        'collection-item:products:team-a:p1': {},
        'collection-item:products:team-b:p1': {}
      }
    })

    it('refreshLists refreshes only the current team list keys of this collection', async () => {
      const { refreshLists } = useCollectionCacheKeys('products')
      await refreshLists()
      const calls = mockRefreshNuxtData.mock.calls.map(c => c[0]).sort()
      expect(calls).toEqual([
        'collection:products:team-a:{"eventId":"e1"}',
        'collection:products:team-a:{}'
      ].sort())
    })

    it('refreshLists always includes the {} key even when nothing is cached', async () => {
      mockPayloadData = {}
      const { refreshLists } = useCollectionCacheKeys('products')
      await refreshLists()
      expect(mockRefreshNuxtData.mock.calls.map(c => c[0])).toEqual(['collection:products:team-a:{}'])
    })

    it('refreshItems refreshes the exact current-team keys, for this or another collection', async () => {
      const { refreshItems } = useCollectionCacheKeys('products')
      await refreshItems(['p1', '', 'p2'])
      await refreshItems('u1', 'users')
      expect(mockRefreshNuxtData.mock.calls.map(c => c[0])).toEqual([
        'collection-item:products:team-a:p1',
        'collection-item:products:team-a:p2',
        'collection-item:users:team-a:u1'
      ])
    })
  })
})
