import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'

let mockPayloadData: Record<string, any> = {}
const mockRefreshNuxtData = vi.fn()
const mockFetch = vi.fn()

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('useRoute', () => ({ path: '/admin/team-a/products', params: { team: 'team-a' } }))
vi.stubGlobal('useTeam', () => ({ currentTeam: ref({ id: 'team-a' }) }))
vi.stubGlobal('useTeamContext', () => ({ getTeamId: () => 'team-a' }))
vi.stubGlobal('useCollections', () => ({
  getConfig: (name: string) => (name === 'products' ? { apiPath: 'shop-products' } : null)
}))
vi.stubGlobal('useNotify', () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.stubGlobal('useT', () => ({ t: (key: string) => key }))
vi.stubGlobal('useNuxtApp', () => ({ payload: { data: mockPayloadData } }))
vi.stubGlobal('refreshNuxtData', mockRefreshNuxtData)
vi.stubGlobal('$fetch', mockFetch)

// The real key builder, resolving to this file's stubs
import { useCollectionCacheKeys } from '../useCollectionCacheKeys'
import { useCollectionImport } from '../useCollectionImport'

vi.stubGlobal('useCollectionCacheKeys', useCollectionCacheKeys)

describe('useCollectionImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ id: 'new' })
    mockPayloadData = {
      'collection:products:team-a:{}': [],
      'collection:products:team-a:{"eventId":"e1"}': [],
      'collection:products:team-b:{}': [],
      'collection:productsArchive:team-a:{}': [],
      'collection-item:products:team-a:p1': {},
      'collection-item:products:team-b:p1': {}
    }
  })

  // covers: T6
  it('executeImport refreshes only the current team list keys (#4506)', async () => {
    const { executeImport } = useCollectionImport('products')

    const result = await executeImport([{ name: 'A' }, { name: 'B' }])

    expect(result.created).toBe(2)
    expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-a/shop-products', expect.objectContaining({ method: 'POST' }))
    const calls = mockRefreshNuxtData.mock.calls.map(c => c[0]).sort()
    expect(calls).toEqual([
      'collection:products:team-a:{"eventId":"e1"}',
      'collection:products:team-a:{}'
    ].sort())
  })
})
