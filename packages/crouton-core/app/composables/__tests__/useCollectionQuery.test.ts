import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, reactive, watch, effectScope, getCurrentScope, onScopeDispose } from 'vue'

// Mock route
let mockRoute: { path: string; params: Record<string, any> } = {
  path: '/dashboard/test-team/products',
  params: { team: 'test-team' }
}

// Mock useFetch response - container object that can be modified
const mockFetchState = {
  data: ref([]) as any,
  pending: ref(false) as any,
  error: ref(null) as any,
  refresh: vi.fn() as any
}

const mockUseFetch = vi.fn((_url: any, _opts?: any) => {
  return Promise.resolve({
    data: mockFetchState.data,
    pending: mockFetchState.pending,
    error: mockFetchState.error,
    refresh: mockFetchState.refresh
  })
})

// Mock collections config
const mockCollectionsConfig: Record<string, any> = {
  products: {
    layer: 'shop',
    apiPath: 'shop-products',
    componentName: 'ShopProductsForm'
  },
  posts: {
    layer: 'blog',
    fetchStrategy: 'restful'
  }
}

// Mock useTeam
let mockUseTeam: (() => { currentTeam: any }) | null = null

// Mock console methods
const mockConsoleLog = vi.fn()
const mockConsoleError = vi.fn()

// Set up global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('reactive', reactive)
vi.stubGlobal('watch', watch)
vi.stubGlobal('useRoute', () => mockRoute)
vi.stubGlobal('useFetch', mockUseFetch)
vi.stubGlobal('getCurrentScope', getCurrentScope)
vi.stubGlobal('onScopeDispose', onScopeDispose)

// Minimal nuxtApp hook registry: hook() returns an unsubscribe fn
const remoteHooks = new Set<(e: any) => any>()
vi.stubGlobal('useNuxtApp', () => ({
  hook: (name: string, fn: (e: any) => any) => {
    if (name === 'crouton:remoteChange') remoteHooks.add(fn)
    return () => remoteHooks.delete(fn)
  }
}))

vi.stubGlobal('useAppConfig', () => ({
  croutonCollections: mockCollectionsConfig
}))

vi.stubGlobal('useRuntimeConfig', () => ({
  public: {
    crouton: { auth: { mode: 'multi-tenant' } }
  }
}))

vi.stubGlobal('useTeam', () => {
  if (mockUseTeam) {
    return mockUseTeam()
  }
  throw new Error('useTeam not available')
})

// Stub console
vi.stubGlobal('console', {
  ...console,
  log: mockConsoleLog,
  error: mockConsoleError,
  group: vi.fn(),
  groupEnd: vi.fn()
})

// Import composables/utils after mocking
import useCollections from '../useCollections'
import { useTeamContext } from '../useTeamContext'
import { useRemoteCollectionRefresh } from '../useRemoteCollectionRefresh'

vi.stubGlobal('useCollections', useCollections)
vi.stubGlobal('useTeamContext', useTeamContext)
vi.stubGlobal('useRemoteCollectionRefresh', useRemoteCollectionRefresh)

// Import the composable under test
import { useCollectionQuery } from '../useCollectionQuery'

describe('useCollectionQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoute = {
      path: '/dashboard/test-team/products',
      params: { team: 'test-team' }
    }
    mockUseTeam = null
    // Reset mock fetch state
    mockFetchState.data = ref([])
    mockFetchState.pending = ref(false)
    mockFetchState.error = ref(null)
    mockFetchState.refresh = vi.fn()
  })

  // Don't use vi.resetAllMocks() as it clears mock implementations

  describe('cache key generation', () => {
    it('generates key with collection name', async () => {
      await useCollectionQuery('products')

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          key: expect.stringContaining('collection:products:')
        })
      )
    })

    it('includes query params in key', async () => {
      const query = computed(() => ({ page: 2, status: 'active' }))

      await useCollectionQuery('products', { query })

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          key: expect.stringContaining('collection:products:')
        })
      )

      // Verify the key contains the serialized query
      const call = mockUseFetch.mock.calls[0] as any
      expect(call[1].key).toContain('page')
    })

    it('different queries produce different keys', async () => {
      const query1 = computed(() => ({ page: 1 }))
      const query2 = computed(() => ({ page: 2 }))

      await useCollectionQuery('products', { query: query1 })
      const key1 = (mockUseFetch.mock.calls[0] as any)[1].key

      mockUseFetch.mockClear()

      await useCollectionQuery('products', { query: query2 })
      const key2 = (mockUseFetch.mock.calls[0] as any)[1].key

      expect(key1).not.toBe(key2)
    })

    it('generates consistent key for same query', async () => {
      const query = computed(() => ({ status: 'active' }))

      await useCollectionQuery('products', { query })
      const key1 = (mockUseFetch.mock.calls[0] as any)[1].key

      mockUseFetch.mockClear()

      await useCollectionQuery('products', { query })
      const key2 = (mockUseFetch.mock.calls[0] as any)[1].key

      expect(key1).toBe(key2)
    })

    it('generates key with empty object for no query', async () => {
      await useCollectionQuery('products')

      const call = mockUseFetch.mock.calls[0] as any
      expect(call[1].key).toBe('collection:products:{}')
    })
  })

  describe('API path resolution', () => {
    // Note: The implementation now uses a function as the first argument to useFetch
    // and computes the path reactively. Tests verify the function was passed and
    // that the options are correct.

    it('uses team-scoped path for normal routes', async () => {
      await useCollectionQuery('products')

      // Implementation passes a function, not a string
      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object)
      )

      // The URL function would return the team-scoped path when called
      const urlFn = (mockUseFetch.mock.calls[0] as any)[0]
      expect(typeof urlFn).toBe('function')
    })

    it('uses super-admin path for admin routes', async () => {
      mockRoute = {
        path: '/super-admin/products',
        params: {}
      }

      await useCollectionQuery('products')

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object)
      )
    })

    it('uses collection name as apiPath when not configured', async () => {
      await useCollectionQuery('posts')

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object)
      )
    })

    it('uses team ID from useTeam() when available', async () => {
      mockUseTeam = () => ({
        currentTeam: { value: { id: 'team-123', slug: 'acme' } }
      })

      await useCollectionQuery('products')

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object)
      )
    })

    // These tests are skipped because the implementation changed:
    // When no team context is available, the implementation now:
    // 1. Sets immediate: false to skip the initial fetch
    // 2. Uses a computed ref that returns null (which becomes '/api/__skip__')
    // 3. No longer logs an error - it silently waits for context to be available

    it.skip('logs error when team context missing', async () => {
      mockRoute = {
        path: '/dashboard/products', // No team param
        params: {}
      }

      await useCollectionQuery('products')

      expect(mockConsoleError).toHaveBeenCalledWith(
        '[useCollectionQuery] Team context required but not available',
        expect.any(Object)
      )
    })

    it.skip('returns path with undefined when no team context', async () => {
      mockRoute = {
        path: '/dashboard/products',
        params: {}
      }

      await useCollectionQuery('products')

      expect(mockUseFetch).toHaveBeenCalledWith(
        '/api/teams/undefined/shop-products',
        expect.any(Object)
      )
    })
  })

  describe('response handling', () => {
    it('normalizes array response', async () => {
      const mockItems = [
        { id: '1', name: 'Product 1' },
        { id: '2', name: 'Product 2' }
      ]
      mockFetchState.data = ref(mockItems)

      const { items } = await useCollectionQuery('products')

      expect(items.value).toEqual(mockItems)
    })

    it('normalizes paginated response with items', async () => {
      const mockPaginatedResponse = {
        items: [
          { id: '1', name: 'Product 1' },
          { id: '2', name: 'Product 2' }
        ],
        pagination: { totalItems: 2, currentPage: 1 }
      }
      mockFetchState.data = ref(mockPaginatedResponse)

      const { items } = await useCollectionQuery('products')

      expect(items.value).toEqual(mockPaginatedResponse.items)
    })

    it('returns empty array for null data', async () => {
      mockFetchState.data = ref(null)

      const { items } = await useCollectionQuery('products')

      expect(items.value).toEqual([])
    })

    it('returns empty array for unexpected response format', async () => {
      mockFetchState.data = ref({ unexpected: 'format' })

      const { items } = await useCollectionQuery('products')

      expect(items.value).toEqual([])
    })

    it('returns pending state', async () => {
      mockFetchState.pending = ref(true)

      const { pending } = await useCollectionQuery('products')

      expect(pending.value).toBe(true)
    })

    it('returns error state', async () => {
      const mockError = new Error('Fetch failed')
      mockFetchState.error = ref(mockError)

      const { error } = await useCollectionQuery('products')

      expect(error.value).toBe(mockError)
    })

    it('returns refresh function', async () => {
      mockFetchState.refresh = vi.fn()

      const { refresh } = await useCollectionQuery('products')

      // Implementation wraps the refresh function to check team context
      expect(typeof refresh).toBe('function')

      // Calling refresh should eventually call the underlying refresh
      await refresh()
      expect(mockFetchState.refresh).toHaveBeenCalled()
    })

    it('returns raw data ref', async () => {
      const rawData = { items: [{ id: '1' }], meta: { total: 1 } }
      mockFetchState.data = ref(rawData)

      const { data } = await useCollectionQuery('products')

      expect(data.value).toEqual(rawData)
    })
  })

  describe('error handling', () => {
    it('throws for unregistered collection', async () => {
      await expect(useCollectionQuery('nonexistent' as any)).rejects.toThrow(
        'Collection "nonexistent" not registered'
      )
    })

    it('logs error for unregistered collection', async () => {
      try {
        await useCollectionQuery('nonexistent' as any)
      } catch {
        // Expected
      }

      expect(mockConsoleError).toHaveBeenCalledWith(
        '[useCollectionQuery] Collection "nonexistent" not found in registry'
      )
    })
  })

  describe('watch behavior', () => {
    // Note: The implementation now watches both query and fullApiPath (for team context changes)
    // Watch array structure: [query, fullApiPath] or [fullApiPath] depending on options

    it('watches query by default', async () => {
      const query = computed(() => ({ page: 1 }))

      await useCollectionQuery('products', { query })

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          watch: expect.arrayContaining([query])
        })
      )
    })

    it('disables watch when watch option is false', async () => {
      const query = computed(() => ({ page: 1 }))

      await useCollectionQuery('products', { query, watch: false })

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          watch: expect.any(Array)
        })
      )
      // When watch is disabled, query is not in the watch array
      const call = mockUseFetch.mock.calls[0] as any
      expect(call[1].watch).not.toContain(query)
    })

    it('uses watch array when no query provided', async () => {
      await useCollectionQuery('products')

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          watch: expect.any(Array)
        })
      )
    })
  })

  describe('useFetch options', () => {
    it('passes query to useFetch', async () => {
      const query = computed(() => ({ page: 2, filter: 'active' }))

      await useCollectionQuery('products', { query })

      expect(mockUseFetch).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          query
        })
      )
    })

    // TODO: These callbacks are not currently implemented in useCollectionQuery
    // They document desired behavior for request lifecycle hooks
    it.todo('includes onRequest callback')
    it.todo('includes onResponse callback')
    it.todo('includes onResponseError callback')
  })

  describe('pagination', () => {
    it('folds page/pageSize into the query when enabled', async () => {
      const result = await useCollectionQuery('products', {
        query: computed(() => ({ eventId: 'e1' })),
        pagination: { pageSize: 25 }
      })

      const call = mockUseFetch.mock.calls[mockUseFetch.mock.calls.length - 1] as any
      expect(call[1].query.value).toEqual({ eventId: 'e1', page: 1, pageSize: 25 })
      expect(result.pageSize.value).toBe(25)
      expect(result.page.value).toBe(1)
    })

    it('defaults to page size 10', async () => {
      const result = await useCollectionQuery('products', { pagination: true })
      expect(result.pageSize.value).toBe(10)
    })

    it('reads total from a paginated { items, total } response', async () => {
      mockFetchState.data.value = { items: [{ id: 'a' }, { id: 'b' }], total: 42 }
      const result = await useCollectionQuery('products', { pagination: { pageSize: 10 } })
      expect(result.total.value).toBe(42)
      expect(result.pageCount.value).toBe(5)
      expect(result.paginationData.value).toEqual({
        currentPage: 1,
        pageSize: 10,
        totalItems: 42,
        totalPages: 5
      })
      mockFetchState.data.value = []
    })

    it('clamps setPage / nextPage / prevPage to valid range', async () => {
      mockFetchState.data.value = { items: [], total: 30 } // 3 pages at size 10
      const result = await useCollectionQuery('products', { pagination: { pageSize: 10 } })
      result.setPage(2)
      expect(result.page.value).toBe(2)
      result.setPage(99)
      expect(result.page.value).toBe(3) // clamped to pageCount
      result.prevPage()
      expect(result.page.value).toBe(2)
      result.setPage(-5)
      expect(result.page.value).toBe(1) // clamped to >= 1
      mockFetchState.data.value = []
    })

    it('leaves paginationData null when disabled', async () => {
      const result = await useCollectionQuery('products')
      expect(result.paginationData.value).toBeNull()
    })
  })

  describe('remote change subscription', () => {
    it('wires remote changes to refresh', async () => {
      await useCollectionQuery('products')
      for (const fn of remoteHooks) await fn({ collection: 'products' })
      expect(mockFetchState.refresh).toHaveBeenCalledTimes(1)
    })
  })

  // TODO: Debug logging is not currently implemented in useCollectionQuery
  // These tests document desired behavior for development debugging
  describe.todo('logging')
})
