import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, unref } from 'vue'

// Mock dependencies
const mockFetch = vi.fn()

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('unref', unref)

vi.stubGlobal('useRoute', () => ({
  path: '/teams/test-team/products'
}))

let mockCollectionConfig = {
  apiPath: 'products',
  fetchStrategy: 'query'
}

vi.stubGlobal('useCollections', () => ({
  getConfig: (name: string) => name === 'products' ? mockCollectionConfig : null
}))

vi.stubGlobal('useTeamContext', () => ({
  getTeamId: () => 'team-123'
}))

vi.stubGlobal('$fetch', mockFetch)

// Mock useAsyncData to simulate Nuxt behavior
let lastAsyncDataOptions: any = null

vi.stubGlobal('useAsyncData', async (key: string, handler: () => Promise<any>, options?: any) => {
  lastAsyncDataOptions = { key, handler, options }

  const data = ref(options?.default?.() ?? undefined)
  const pending = ref(true)
  const error = ref(null)

  // If server: false, simulate SSR behavior (skip handler, stay pending)
  if (options?.server === false) {
    return { data, pending, error, refresh: async () => {
      pending.value = true
      error.value = null
      try {
        const result = await handler()
        data.value = result
      } catch (e: any) {
        error.value = e
      } finally {
        pending.value = false
      }
    } }
  }

  try {
    const result = await handler()
    data.value = result
    pending.value = false
  } catch (e: any) {
    error.value = e
    pending.value = false
  }

  const refresh = async () => {
    pending.value = true
    error.value = null
    try {
      const result = await handler()
      data.value = result
    } catch (e: any) {
      error.value = e
    } finally {
      pending.value = false
    }
  }

  return { data, pending, error, refresh }
})

// Import after mocking
import { useCollectionItem } from '../useCollectionItem'

describe('useCollectionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue([{ id: 'item-1', name: 'Test Item' }])
    mockCollectionConfig = {
      apiPath: 'products',
      fetchStrategy: 'query'
    }
    lastAsyncDataOptions = null
  })

  describe('initialization', () => {
    it('returns item, pending, error, and refresh', async () => {
      const result = await useCollectionItem('products', 'item-1')

      expect(result.item).toBeDefined()
      expect(result.pending).toBeDefined()
      expect(result.error).toBeDefined()
      expect(result.refresh).toBeDefined()
    })

    it('throws error for unregistered collection', async () => {
      await expect(useCollectionItem('unknown', 'item-1')).rejects.toThrow('Collection "unknown" not registered')
    })
  })

  describe('fetch with string id', () => {
    it('fetches item with query strategy', async () => {
      await useCollectionItem('products', 'item-1')

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-123/products?ids=item-1', { headers: undefined })
    })

    it('returns first item from array response (query strategy)', async () => {
      mockFetch.mockResolvedValue([
        { id: 'item-1', name: 'First' },
        { id: 'item-2', name: 'Second' }
      ])

      const { item } = await useCollectionItem('products', 'item-1')

      expect(item.value).toEqual({ id: 'item-1', name: 'First' })
    })
  })

  describe('fetch with restful strategy', () => {
    beforeEach(() => {
      mockCollectionConfig = {
        apiPath: 'products',
        fetchStrategy: 'restful'
      }
    })

    it('fetches item with RESTful path', async () => {
      mockFetch.mockResolvedValue({ id: 'item-1', name: 'Test' })

      await useCollectionItem('products', 'item-1')

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-123/products/item-1', { headers: undefined })
    })

    it('returns object directly (restful strategy)', async () => {
      mockFetch.mockResolvedValue({ id: 'item-1', name: 'Direct' })

      const { item } = await useCollectionItem('products', 'item-1')

      expect(item.value).toEqual({ id: 'item-1', name: 'Direct' })
    })
  })

  describe('super-admin routes', () => {
    beforeEach(() => {
      vi.stubGlobal('useRoute', () => ({
        path: '/super-admin/products'
      }))
    })

    afterEach(() => {
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/test-team/products'
      }))
    })

    it('uses super-admin path', async () => {
      await useCollectionItem('products', 'item-1')

      expect(mockFetch).toHaveBeenCalledWith('/api/super-admin/products?ids=item-1', { headers: undefined })
    })
  })

  describe('reactive id parameter', () => {
    it('handles ref id', async () => {
      const idRef = ref('item-1')

      await useCollectionItem('products', idRef)

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-123/products?ids=item-1', { headers: undefined })
    })

    it('handles function id', async () => {
      const idFn = () => 'item-1'

      await useCollectionItem('products', idFn)

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-123/products?ids=item-1', { headers: undefined })
    })

    it('passes watch option with itemId to useAsyncData', async () => {
      await useCollectionItem('products', 'item-1')

      expect(lastAsyncDataOptions.options.watch).toBeDefined()
      expect(lastAsyncDataOptions.options.watch.length).toBe(1)
    })
  })

  describe('empty id handling', () => {
    it('returns null item for empty string id', async () => {
      const { item } = await useCollectionItem('products', '')

      expect(item.value).toBeNull()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('team context handling', () => {
    beforeEach(() => {
      vi.stubGlobal('useTeamContext', () => ({
        getTeamId: () => undefined
      }))
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/unknown/products'
      }))
    })

    afterEach(() => {
      vi.stubGlobal('useTeamContext', () => ({
        getTeamId: () => 'team-123'
      }))
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/test-team/products'
      }))
    })

    it('sets pending and skips fetch when team context missing', async () => {
      const { pending } = await useCollectionItem('products', 'item-1')

      expect(pending.value).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('sets server:false on useAsyncData when team context missing', async () => {
      await useCollectionItem('products', 'item-1')

      expect(lastAsyncDataOptions.options.server).toBe(false)
    })
  })

  describe('error handling', () => {
    it('sets error on fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { error } = await useCollectionItem('products', 'item-1')

      expect(error.value).toBeInstanceOf(Error)
      expect(error.value.message).toBe('Network error')
    })

    it('sets pending to false after error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed'))

      const { pending } = await useCollectionItem('products', 'item-1')

      expect(pending.value).toBe(false)
    })
  })

  describe('refresh function', () => {
    it('returns refresh function that refetches', async () => {
      const { refresh } = await useCollectionItem('products', 'item-1')

      expect(mockFetch).toHaveBeenCalledTimes(1)

      await refresh()

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('custom apiPath', () => {
    beforeEach(() => {
      mockCollectionConfig = {
        apiPath: 'custom-products',
        fetchStrategy: 'query'
      }
    })

    it('uses custom apiPath from config', async () => {
      await useCollectionItem('products', 'item-1')

      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-123/custom-products?ids=item-1', { headers: undefined })
    })
  })

  describe('response handling', () => {
    it('handles null response', async () => {
      mockFetch.mockResolvedValue(null)

      const { item } = await useCollectionItem('products', 'item-1')

      // For query strategy, null response should result in null item
      expect(item.value).toBeNull()
    })

    it('handles empty array response', async () => {
      mockFetch.mockResolvedValue([])

      const { item } = await useCollectionItem('products', 'item-1')

      expect(item.value).toBeNull()
    })

    it('handles non-array response with query strategy', async () => {
      mockFetch.mockResolvedValue({ id: 'item-1', name: 'Direct' })

      const { item } = await useCollectionItem('products', 'item-1')

      // Non-array response should be returned directly
      expect(item.value).toEqual({ id: 'item-1', name: 'Direct' })
    })
  })
})
