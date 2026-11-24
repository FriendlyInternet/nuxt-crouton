import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, unref, reactive, watch, nextTick } from 'vue'

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

// useTeam() is resolved once at setup by useCollectionItem; count the calls (T6)
const mockCurrentTeam = ref<{ id?: string } | null>({ id: 'team-123' })
let useTeamCalls = 0
const useTeamStub = () => {
  useTeamCalls++
  return { currentTeam: mockCurrentTeam }
}
vi.stubGlobal('useTeam', useTeamStub)

vi.stubGlobal('$fetch', mockFetch)

// Mock useAsyncData to simulate Nuxt behavior
let lastAsyncDataOptions: any = null

const resolveKey = (key: string | (() => string)) => typeof key === 'function' ? key() : key

const simpleAsyncData = async (key: string | (() => string), handler: () => Promise<any>, options?: any) => {
  lastAsyncDataOptions = { key, resolvedKey: resolveKey(key), handler, options }

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
}
vi.stubGlobal('useAsyncData', simpleAsyncData)

// A closer Nuxt model for the cache-slot rule (T5): one shared key→data store,
// the key re-resolved reactively, a refetch when the key or a watch source changes.
const sharedStore = reactive<Record<string, any>>({})
const sharedAsyncData = async (key: string | (() => string), handler: () => Promise<any>, options?: any) => {
  const getKey = () => resolveKey(key)
  const pending = ref(true)
  const error = ref(null)
  const run = async () => {
    const k = getKey()
    sharedStore[k] = await handler()
    pending.value = false
  }
  watch(getKey, run)
  if (options?.watch?.length) watch(options.watch, run)
  await run()
  const data = computed(() => sharedStore[getKey()] ?? null)
  return { data, pending, error, refresh: run }
}

const flush = async () => {
  await nextTick()
  await new Promise(r => setTimeout(r, 0))
  await nextTick()
}

// Import after mocking — the real key builder (#4506), resolving to this file's stubs
import { useCollectionCacheKeys } from '../useCollectionCacheKeys'
import { useCollectionItem } from '../useCollectionItem'

vi.stubGlobal('useCollectionCacheKeys', useCollectionCacheKeys)

describe('useCollectionItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue([{ id: 'item-1', name: 'Test Item' }])
    mockCollectionConfig = {
      apiPath: 'products',
      fetchStrategy: 'query'
    }
    lastAsyncDataOptions = null
    mockCurrentTeam.value = { id: 'team-123' }
    useTeamCalls = 0
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

    it('passes a getter key and no watch option to useAsyncData (#4489)', async () => {
      await useCollectionItem('products', 'item-1')

      expect(typeof lastAsyncDataOptions.key).toBe('function')
      expect(lastAsyncDataOptions.options.watch).toBeUndefined()
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
      mockCurrentTeam.value = null
      vi.stubGlobal('useRoute', () => ({
        path: '/teams/unknown/products'
      }))
    })

    afterEach(() => {
      mockCurrentTeam.value = { id: 'team-123' }
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

  describe('cache key follows the record and the team (#4489)', () => {
    beforeEach(() => {
      mockCurrentTeam.value = { id: 'team-a' }
    })

    it('T1: changing the id moves the key to the new id', async () => {
      const idRef = ref('item-1')
      await useCollectionItem('products', idRef)
      const key = lastAsyncDataOptions.key

      expect(resolveKey(key)).toBe('collection-item:products:team-a:item-1')
      idRef.value = 'item-2'
      expect(resolveKey(key)).toBe('collection-item:products:team-a:item-2')
    })

    it('T2: switching the team changes the key to the new team', async () => {
      await useCollectionItem('products', 'item-1')
      const key = lastAsyncDataOptions.key

      expect(resolveKey(key)).toBe('collection-item:products:team-a:item-1')
      mockCurrentTeam.value = { id: 'team-b' }
      expect(resolveKey(key)).toBe('collection-item:products:team-b:item-1')
    })

    it('T3: two ids in the same collection get two different keys', async () => {
      await useCollectionItem('products', 'item-1')
      const first = lastAsyncDataOptions.resolvedKey
      await useCollectionItem('products', 'item-2')
      const second = lastAsyncDataOptions.resolvedKey

      expect(first).toBe('collection-item:products:team-a:item-1')
      expect(second).toBe('collection-item:products:team-a:item-2')
    })

    it('uses super-admin as the team part on super-admin routes', async () => {
      vi.stubGlobal('useRoute', () => ({ path: '/super-admin/products' }))
      try {
        await useCollectionItem('products', 'item-1')
        expect(lastAsyncDataOptions.resolvedKey).toBe('collection-item:products:super-admin:item-1')
      } finally {
        vi.stubGlobal('useRoute', () => ({ path: '/teams/test-team/products' }))
      }
    })

    it('falls back to the route team param when useTeam has no team', async () => {
      mockCurrentTeam.value = null
      vi.stubGlobal('useRoute', () => ({ path: '/admin/acme/products', params: { team: 'acme' } }))
      try {
        await useCollectionItem('products', 'item-1')
        expect(lastAsyncDataOptions.resolvedKey).toBe('collection-item:products:acme:item-1')
        expect(mockFetch).toHaveBeenCalledWith('/api/teams/acme/products?ids=item-1', { headers: undefined })
      } finally {
        vi.stubGlobal('useRoute', () => ({ path: '/teams/test-team/products' }))
      }
    })

    it('T5: two views never share a slot for different records or teams', async () => {
      for (const k of Object.keys(sharedStore)) delete sharedStore[k]
      mockFetch.mockImplementation(async (url: string) => {
        const team = url.split('/')[3]
        const id = url.split('?ids=')[1]
        return [{ id, team }]
      })
      vi.stubGlobal('useAsyncData', sharedAsyncData)
      try {
        const view1Id = ref('item-1')
        const view1 = await useCollectionItem('products', view1Id)
        const view2 = await useCollectionItem('products', 'item-1')
        expect(view1.item.value).toEqual({ id: 'item-1', team: 'team-a' })
        expect(view2.item.value).toEqual({ id: 'item-1', team: 'team-a' })

        view1Id.value = 'item-2'
        await flush()
        expect(view1.item.value).toEqual({ id: 'item-2', team: 'team-a' })
        expect(view2.item.value).toEqual({ id: 'item-1', team: 'team-a' })

        mockCurrentTeam.value = { id: 'team-b' }
        await flush()
        expect(view1.item.value).toEqual({ id: 'item-2', team: 'team-b' })
        expect(view2.item.value).toEqual({ id: 'item-1', team: 'team-b' })
      } finally {
        vi.stubGlobal('useAsyncData', simpleAsyncData)
      }
    })

    it('T6: re-resolving the key after setup does not call useTeam() again', async () => {
      const idRef = ref('item-1')
      await useCollectionItem('products', idRef)
      expect(useTeamCalls).toBe(1)

      const key = lastAsyncDataOptions.key
      resolveKey(key)
      idRef.value = 'item-2'
      resolveKey(key)
      mockCurrentTeam.value = { id: 'team-b' }
      resolveKey(key)

      expect(useTeamCalls).toBe(1)
    })
  })
})
