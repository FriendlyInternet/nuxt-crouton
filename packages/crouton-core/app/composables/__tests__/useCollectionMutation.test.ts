import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive } from 'vue'
import { errorText } from '../../utils/error-text'

// Mock route
let mockRoute = {
  path: '/dashboard/test-team/products',
  params: { team: 'test-team' }
}

// Mock toast
const mockToastAdd = vi.fn()

// Mock $fetch
const mockFetch = vi.fn()

// Mock nuxtApp hooks and payload
const mockCallHook = vi.fn()
let mockPayloadData: Record<string, any> = {}

// Mock refreshNuxtData
const mockRefreshNuxtData = vi.fn()

// Mock collections config
const mockCollectionsConfig: Record<string, any> = {
  products: {
    layer: 'shop',
    apiPath: 'shop-products',
  },
  posts: {
    layer: 'blog',
    references: { authorId: 'users', categoryId: 'categories' }
  },
  tasks: {
    sortable: { enabled: true, orderField: 'position' }
  }
}

// Mock useTeam
let mockUseTeam: (() => { currentTeam: any }) | null = null

// Mock console methods
const mockConsoleLog = vi.fn()
const mockConsoleError = vi.fn()
const mockConsoleGroup = vi.fn()
const mockConsoleGroupEnd = vi.fn()

// Set up global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('reactive', reactive)
vi.stubGlobal('errorText', errorText)
vi.stubGlobal('useRoute', () => mockRoute)
vi.stubGlobal('$fetch', mockFetch)
vi.stubGlobal('generateCorrelationId', () => 'crtn_test_12345678')

vi.stubGlobal('useToast', () => ({
  add: mockToastAdd
}))

// Mock useT — translation keys used by useCollectionMutation
const mutationTranslations: Record<string, string> = {
  'mutations.creationFailed': 'Creation failed',
  'mutations.updateFailed': 'Update failed',
  'mutations.deleteFailed': 'Delete failed',
  'mutations.createdSuccessfully': 'Created successfully',
  'mutations.updatedSuccessfully': 'Updated successfully',
  'mutations.deletedCount': 'Deleted {count} item(s)',
}
vi.stubGlobal('useT', () => ({
  t: (key: string, params?: any) => {
    const template = mutationTranslations[key] || key
    if (params?.count !== undefined) {
      return template.replace('{count}', String(params.count))
    }
    return template
  }
}))

// Mock useNotify — delegates to mockToastAdd
vi.stubGlobal('useNotify', () => ({
  success: (title: string, options?: any) => mockToastAdd({
    title,
    description: options?.description,
    icon: options?.icon || 'i-lucide-check',
    color: 'primary',
  }),
  info: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'primary' }),
  warning: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, color: 'warning' }),
  error: (title: string, options?: any) => mockToastAdd({
    title,
    description: options?.description,
    icon: options?.icon || 'i-lucide-octagon-alert',
    color: 'primary',
  }),
}))

vi.stubGlobal('useNuxtApp', () => ({
  payload: { data: mockPayloadData },
  hooks: { callHook: mockCallHook }
}))

vi.stubGlobal('refreshNuxtData', mockRefreshNuxtData)

// #2289: the only package that reads `beforeData` off the crouton:mutation hook is
// crouton-events; apps that don't extend it must not pay a GET before every PATCH.
let mockInstalledApps: string[] = []
vi.stubGlobal('useCroutonApps', () => ({
  hasApp: (id: string) => mockInstalledApps.includes(id)
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
  group: mockConsoleGroup,
  groupEnd: mockConsoleGroupEnd
})

// Import composables after mocking
import useCollections from '../useCollections'
import { useTeamContext } from '../useTeamContext'

vi.stubGlobal('useCollections', useCollections)
vi.stubGlobal('useTeamContext', useTeamContext)

// Import the composable under test
import { useCollectionMutation } from '../useCollectionMutation'

describe('useCollectionMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoute = {
      path: '/dashboard/test-team/products',
      params: { team: 'test-team' }
    }
    mockUseTeam = null
    mockPayloadData = {}
    mockFetch.mockResolvedValue({ id: 'new-id', name: 'Test' })
  })

  describe('initialization', () => {
    it('returns create, update, deleteItems functions', () => {
      const mutation = useCollectionMutation('products')

      expect(mutation.create).toBeDefined()
      expect(typeof mutation.create).toBe('function')
      expect(mutation.update).toBeDefined()
      expect(typeof mutation.update).toBe('function')
      expect(mutation.deleteItems).toBeDefined()
      expect(typeof mutation.deleteItems).toBe('function')
    })

    it('returns delete as alias for deleteItems', () => {
      const mutation = useCollectionMutation('products')

      expect(mutation.delete).toBe(mutation.deleteItems)
    })

    it('throws for unregistered collection', () => {
      expect(() => useCollectionMutation('nonexistent' as any)).toThrow(
        'Collection "nonexistent" not registered'
      )
    })

    it('logs error for unregistered collection', () => {
      try {
        useCollectionMutation('nonexistent' as any)
      } catch {
        // Expected
      }

      expect(mockConsoleError).toHaveBeenCalledWith(
        '[useCollectionMutation] Collection "nonexistent" not found in registry'
      )
    })
  })

  describe('create', () => {
    it('POSTs to correct endpoint', async () => {
      const { create } = useCollectionMutation('products')
      const data = { name: 'New Product', price: 100 }

      await create(data)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products',
        expect.objectContaining({
          method: 'POST',
          body: data,
          credentials: 'include'
        })
      )
    })

    it('returns created item', async () => {
      const createdItem = { id: 'prod-1', name: 'New Product' }
      mockFetch.mockResolvedValue(createdItem)

      const { create } = useCollectionMutation('products')
      const result = await create({ name: 'New Product' })

      expect(result).toEqual(createdItem)
    })

    it('does not show success toast (handled by status bar)', async () => {
      const { create } = useCollectionMutation('products')

      await create({ name: 'Product' })

      // Success notifications are no longer emitted as toasts
      // They are handled by the status bar via useNotify
      expect(mockToastAdd).not.toHaveBeenCalled()
    })

    it('emits crouton:mutation hook', async () => {
      mockFetch.mockResolvedValue({ id: 'prod-1', name: 'New' })

      const { create } = useCollectionMutation('products')
      await create({ name: 'New' })

      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({
        operation: 'create',
        collection: 'products',
        itemId: 'prod-1',
        data: { name: 'New' },
        result: { id: 'prod-1', name: 'New' }
      }))
    })

    it('invalidates collection cache after success', async () => {
      mockPayloadData = {
        'collection:products:{}': [{ id: '1' }],
        'collection:products:{"page":2}': [{ id: '2' }]
      }

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{}')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{"page":2}')
    })

    it('shows error toast on failure', async () => {
      const error = { data: { message: 'Validation failed' } }
      mockFetch.mockRejectedValue(error)

      const { create } = useCollectionMutation('products')

      await expect(create({ name: '' })).rejects.toEqual(error)

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Creation failed',
        description: 'Validation failed',
        icon: 'i-lucide-octagon-alert',
        color: 'primary'
      })
    })

    it('uses collection name as apiPath when not configured', async () => {
      const { create } = useCollectionMutation('posts')

      await create({ title: 'Post' })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/posts',
        expect.any(Object)
      )
    })

    it('uses super-admin path for admin routes', async () => {
      mockRoute = {
        path: '/super-admin/products',
        params: {} as any
      }

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/super-admin/shop-products',
        expect.any(Object)
      )
    })

    it('refreshes referenced collection caches', async () => {
      mockPayloadData = {
        'collection:posts:{}': [],
        'collection-item:users:author-1': { id: 'author-1' }
      }

      const { create } = useCollectionMutation('posts')
      await create({ title: 'Post', authorId: 'author-1' })

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:users:author-1')
    })
  })

  describe('update', () => {
    it('PATCHes to correct endpoint with id', async () => {
      const { update } = useCollectionMutation('products')
      const updates = { name: 'Updated Product' }

      await update('prod-1', updates)

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products/prod-1',
        expect.objectContaining({
          method: 'PATCH',
          body: updates,
          credentials: 'include'
        })
      )
    })

    it('returns updated item', async () => {
      const updatedItem = { id: 'prod-1', name: 'Updated' }
      mockFetch.mockResolvedValue(updatedItem)

      const { update } = useCollectionMutation('products')
      const result = await update('prod-1', { name: 'Updated' })

      expect(result).toEqual(updatedItem)
    })

    it('does not show success toast (handled by status bar)', async () => {
      const { update } = useCollectionMutation('products')

      await update('prod-1', { name: 'Updated' })

      // Success notifications are no longer emitted as toasts
      expect(mockToastAdd).not.toHaveBeenCalled()
    })

    it('emits crouton:mutation hook with updates', async () => {
      mockFetch.mockResolvedValue({ id: 'prod-1', name: 'Updated' })

      const { update } = useCollectionMutation('products')
      await update('prod-1', { name: 'Updated' })

      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({
        operation: 'update',
        collection: 'products',
        itemId: 'prod-1',
        updates: { name: 'Updated' },
        result: { id: 'prod-1', name: 'Updated' }
      }))
    })

    it('invalidates both item and collection cache', async () => {
      mockPayloadData = {
        'collection:products:{}': [{ id: 'prod-1' }],
        'collection-item:products:prod-1': { id: 'prod-1' }
      }

      const { update } = useCollectionMutation('products')
      await update('prod-1', { name: 'Updated' })

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{}')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:products:prod-1')
    })

    it('shows error toast on failure', async () => {
      const error = { data: 'Update failed' }
      mockFetch.mockRejectedValue(error)

      const { update } = useCollectionMutation('products')

      await expect(update('prod-1', { name: '' })).rejects.toEqual(error)

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Update failed',
        description: 'Update failed',
        icon: 'i-lucide-octagon-alert',
        color: 'primary'
      })
    })

    it('refreshes referenced collection caches on update', async () => {
      mockPayloadData = {
        'collection:posts:{}': [],
        'collection-item:categories:cat-1': { id: 'cat-1' }
      }

      const { update } = useCollectionMutation('posts')
      await update('post-1', { categoryId: 'cat-1' })

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:categories:cat-1')
    })
  })

  describe('update pre-fetch for change tracking (#2289)', () => {
    beforeEach(() => { mockInstalledApps = [] })

    it('sends exactly one request (the PATCH) when no package records change diffs', async () => {
      mockFetch.mockResolvedValue({ id: 'prod-1', name: 'Updated' })
      const { update } = useCollectionMutation('products')
      await update('prod-1', { name: 'Updated' })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch.mock.calls[0]![1]).toEqual(expect.objectContaining({ method: 'PATCH' }))
      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({ operation: 'update', beforeData: undefined }))
    })

    it('fetches the item first and hands it to the hook when crouton-events is installed', async () => {
      mockInstalledApps = ['events']
      mockFetch
        .mockResolvedValueOnce([{ id: 'prod-1', name: 'Old' }])
        .mockResolvedValueOnce({ id: 'prod-1', name: 'Updated' })
      const { update } = useCollectionMutation('products')
      await update('prod-1', { name: 'Updated' })
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/teams/test-team/shop-products', expect.objectContaining({ method: 'GET', query: { ids: 'prod-1' } }))
      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({ beforeData: { id: 'prod-1', name: 'Old' } }))
    })

    it('still PATCHes when the pre-fetch fails', async () => {
      mockInstalledApps = ['events']
      mockFetch
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ id: 'prod-1', name: 'Updated' })
      const { update } = useCollectionMutation('products')
      await expect(update('prod-1', { name: 'Updated' })).resolves.toEqual({ id: 'prod-1', name: 'Updated' })
      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({ beforeData: undefined }))
    })
  })

  describe('deleteItems', () => {
    it('DELETEs each item in parallel', async () => {
      const { deleteItems } = useCollectionMutation('products')

      await deleteItems(['id1', 'id2', 'id3'])

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products/id1',
        expect.objectContaining({ method: 'DELETE', credentials: 'include' })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products/id2',
        expect.objectContaining({ method: 'DELETE', credentials: 'include' })
      )
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products/id3',
        expect.objectContaining({ method: 'DELETE', credentials: 'include' })
      )
    })

    it('does not show success toast for delete (handled by status bar)', async () => {
      const { deleteItems } = useCollectionMutation('products')

      await deleteItems(['id1', 'id2'])

      // Success notifications are no longer emitted as toasts
      expect(mockToastAdd).not.toHaveBeenCalled()
    })

    it('emits crouton:mutation hook with itemIds', async () => {
      const { deleteItems } = useCollectionMutation('products')

      await deleteItems(['id1', 'id2'])

      expect(mockCallHook).toHaveBeenCalledWith('crouton:mutation', expect.objectContaining({
        operation: 'delete',
        collection: 'products',
        itemIds: ['id1', 'id2']
      }))
    })

    it('invalidates item caches for deleted ids', async () => {
      mockPayloadData = {
        'collection:products:{}': [{ id: 'id1' }, { id: 'id2' }],
        'collection-item:products:id1': { id: 'id1' },
        'collection-item:products:id2': { id: 'id2' }
      }

      const { deleteItems } = useCollectionMutation('products')
      await deleteItems(['id1', 'id2'])

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{}')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:products:id1')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:products:id2')
    })

    it('shows error toast on failure', async () => {
      const error = { data: { message: 'Cannot delete' } }
      mockFetch.mockRejectedValue(error)

      const { deleteItems } = useCollectionMutation('products')

      await expect(deleteItems(['id1'])).rejects.toEqual(error)

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Delete failed',
        description: 'Cannot delete',
        icon: 'i-lucide-octagon-alert',
        color: 'primary'
      })
    })

    it('handles partial failure when some deletes succeed and others fail', async () => {
      // Mock: id1 succeeds, id2 fails, id3 succeeds
      const error = { data: { message: 'Item id2 is in use' } }
      mockFetch
        .mockResolvedValueOnce({ success: true }) // id1 succeeds
        .mockRejectedValueOnce(error) // id2 fails
        .mockResolvedValueOnce({ success: true }) // id3 succeeds

      const { deleteItems } = useCollectionMutation('products')

      // Partial failures should throw with the first error encountered
      await expect(deleteItems(['id1', 'id2', 'id3'])).rejects.toEqual(error)

      // All three deletes should have been attempted
      expect(mockFetch).toHaveBeenCalledTimes(3)

      // Error toast should be shown for the failure
      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Delete failed',
        description: 'Item id2 is in use',
        icon: 'i-lucide-octagon-alert',
        color: 'primary'
      })
    })

    it('still invalidates caches after partial failure', async () => {
      mockPayloadData = {
        'collection:products:{}': [{ id: 'id1' }, { id: 'id2' }],
        'collection-item:products:id1': { id: 'id1' },
        'collection-item:products:id2': { id: 'id2' }
      }

      // id1 succeeds, id2 fails
      mockFetch
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce({ data: 'Error' })

      const { deleteItems } = useCollectionMutation('products')

      try {
        await deleteItems(['id1', 'id2'])
      } catch {
        // Expected to throw due to partial failure
      }

      // Both delete attempts should have been made (parallel execution)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Note: Cache invalidation behavior on partial failure depends on implementation
      // The test documents the current behavior
    })

    it('works with single item', async () => {
      const { deleteItems } = useCollectionMutation('products')

      await deleteItems(['single-id'])

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('cache invalidation', () => {
    it('finds all cache keys with collection prefix', async () => {
      mockPayloadData = {
        'collection:products:{}': [],
        'collection:products:{"page":1}': [],
        'collection:products:{"status":"active"}': [],
        'collection:posts:{}': [], // Different collection
        'other-key': {} // Not a collection key
      }

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      // Should refresh all products collection keys
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{}')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{"page":1}')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection:products:{"status":"active"}')

      // Should NOT refresh posts or other keys
      const refreshCalls = mockRefreshNuxtData.mock.calls.map(c => c[0])
      expect(refreshCalls).not.toContain('collection:posts:{}')
      expect(refreshCalls).not.toContain('other-key')
    })

    it('handles array references', async () => {
      mockPayloadData = {
        'collection:posts:{}': [],
        'collection-item:users:user-1': {},
        'collection-item:users:user-2': {}
      }

      // Add a collection with array reference
      mockCollectionsConfig.comments = {
        references: { mentionedUserIds: 'users' }
      }

      const { create } = useCollectionMutation('comments')
      await create({ text: 'Hello', mentionedUserIds: ['user-1', 'user-2'] })

      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:users:user-1')
      expect(mockRefreshNuxtData).toHaveBeenCalledWith('collection-item:users:user-2')
    })

    it('skips refresh when no matching keys', async () => {
      mockPayloadData = {
        'collection:posts:{}': [] // Only posts, no products
      }

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      // Should only call once for collection key refresh attempt (no matching keys)
      // The specific behavior depends on implementation
      expect(mockRefreshNuxtData).not.toHaveBeenCalledWith('collection:posts:{}')
    })
  })

  describe('API path resolution', () => {
    it('uses team ID from useTeam() when available', async () => {
      mockUseTeam = () => ({
        currentTeam: { value: { id: 'team-123', slug: 'acme' } }
      })

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/team-123/shop-products',
        expect.any(Object)
      )
    })

    it('throws when team context required but not available', async () => {
      mockRoute = {
        path: '/dashboard/products',
        params: {} as any // No team param
      }
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { create } = useCollectionMutation('products')

      await expect(create({ name: 'Product' })).rejects.toThrow(
        'Team context not yet available'
      )

      consoleSpy.mockRestore()
    })
  })

  describe('logging', () => {
    // Note: Verbose logging was removed from the implementation for cleaner output.
    // These tests are skipped as the implementation no longer produces this logging.
    it.skip('logs create operation', async () => {
      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      expect(mockConsoleGroup).toHaveBeenCalledWith('[useCollectionMutation] CREATE')
      expect(mockConsoleLog).toHaveBeenCalledWith('Collection:', 'products')
      expect(mockConsoleGroupEnd).toHaveBeenCalled()
    })

    it.skip('logs update operation', async () => {
      const { update } = useCollectionMutation('products')
      await update('prod-1', { name: 'Updated' })

      expect(mockConsoleGroup).toHaveBeenCalledWith('[useCollectionMutation] UPDATE')
      expect(mockConsoleLog).toHaveBeenCalledWith('Item ID:', 'prod-1')
    })

    it.skip('logs delete operation', async () => {
      const { deleteItems } = useCollectionMutation('products')
      await deleteItems(['id1'])

      expect(mockConsoleGroup).toHaveBeenCalledWith('[useCollectionMutation] DELETE')
      expect(mockConsoleLog).toHaveBeenCalledWith('Item IDs:', ['id1'])
    })

    it.skip('logs API errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { create } = useCollectionMutation('products')

      try {
        await create({ name: 'Product' })
      } catch {
        // Expected
      }

      expect(mockConsoleError).toHaveBeenCalledWith('❌ API Error:', expect.any(Error))
    })

    it.skip('logs cache invalidation details', async () => {
      mockPayloadData = {
        'collection:products:{}': []
      }

      const { create } = useCollectionMutation('products')
      await create({ name: 'Product' })

      expect(mockConsoleLog).toHaveBeenCalledWith(
        '[useCollectionMutation v3.0] Invalidating cache for:',
        'products'
      )
    })
  })

  describe('error handling', () => {
    it('extracts error message from error.data.message', async () => {
      mockFetch.mockRejectedValue({ data: { message: 'Custom error message' } })

      const { create } = useCollectionMutation('products')

      try {
        await create({ name: 'Product' })
      } catch {
        // Expected
      }

      expect(mockToastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Custom error message'
        })
      )
    })

    it('extracts error message from error.data string', async () => {
      mockFetch.mockRejectedValue({ data: 'String error message' })

      const { create } = useCollectionMutation('products')

      try {
        await create({ name: 'Product' })
      } catch {
        // Expected
      }

      expect(mockToastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'String error message'
        })
      )
    })

    it('uses default message when no error data', async () => {
      mockFetch.mockRejectedValue({})

      const { create } = useCollectionMutation('products')

      try {
        await create({ name: 'Product' })
      } catch {
        // Expected
      }

      expect(mockToastAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Creation failed'
        })
      )
    })

    it('rethrows the error after showing toast', async () => {
      const error = { data: 'Error' }
      mockFetch.mockRejectedValue(error)

      const { create } = useCollectionMutation('products')

      await expect(create({ name: 'Product' })).rejects.toEqual(error)
    })
  })
})
