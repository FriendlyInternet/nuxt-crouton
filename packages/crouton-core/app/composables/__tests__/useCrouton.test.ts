import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, reactive } from 'vue'
import en from '../../../i18n/locales/en.json'

// State holders for useState mock
const stateStore: Record<string, any> = {}

// Mock toast calls
const mockToastAdd = vi.fn()

// Mock $fetch
const mockFetch = vi.fn()

// Mock error checker
const mockFoundErrors = vi.fn(() => false)

// Mock route
let mockRoute: { path: string; params: Record<string, any> } = {
  path: '/dashboard/test-team/products',
  params: { team: 'test-team' }
}

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

// Mock useTeam (throws by default, set to return value to simulate @crouton/auth)
let mockUseTeam: (() => { currentTeam: any }) | null = null

// Set up all global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('reactive', reactive)

// useT is auto-imported at runtime; resolve keys against the real English locale
vi.stubGlobal('useT', () => ({
  t: (key: string, params: Record<string, unknown> = {}) => {
    const msg = key.split('.').reduce<any>((node, part) => node?.[part], en)
    return typeof msg === 'string' ? msg.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : key
  }
}))

vi.stubGlobal('useRoute', () => mockRoute)

vi.stubGlobal('useState', (key: string, init: () => any) => {
  if (!stateStore[key]) {
    stateStore[key] = ref(init())
  }
  return stateStore[key]
})

vi.stubGlobal('useToast', () => ({
  add: mockToastAdd
}))

// Mock useNotify — delegates to mockToastAdd
vi.stubGlobal('useNotify', () => ({
  success: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, icon: options?.icon || 'i-lucide-check', color: 'success' }),
  info: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, icon: options?.icon || 'i-lucide-info', color: 'primary' }),
  warning: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, icon: options?.icon || 'i-lucide-alert-triangle', color: 'warning' }),
  error: (title: string, options?: any) => mockToastAdd({ title, description: options?.description, icon: options?.icon || 'i-lucide-octagon-alert', color: 'error' }),
}))

vi.stubGlobal('$fetch', mockFetch)

vi.stubGlobal('useCroutonError', () => ({
  foundErrors: mockFoundErrors
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

// Import composables after mocking
import useCrouton from '../useCrouton'
import useCollections from '../useCollections'
import { useCroutonPagination } from '../useCroutonPagination'

// Also stub useCollections
vi.stubGlobal('useCollections', useCollections)

// Stub useCroutonPagination so useCrouton can destructure it via auto-import
vi.stubGlobal('useCroutonPagination', useCroutonPagination)

// And useTeamContext needs to be imported after mocks
import { useTeamContext } from '../useTeamContext'
vi.stubGlobal('useTeamContext', useTeamContext)

describe('useCrouton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset state store
    Object.keys(stateStore).forEach(key => delete stateStore[key])
    // Reset mocks
    mockFoundErrors.mockReturnValue(false)
    mockRoute = {
      path: '/dashboard/test-team/products',
      params: { team: 'test-team' }
    }
    mockUseTeam = null
  })

  describe('state initialization', () => {
    it('initializes with empty croutonStates array', () => {
      const { croutonStates } = useCrouton()
      expect(croutonStates.value).toEqual([])
    })

    it('showCrouton is false when no states', () => {
      const { showCrouton } = useCrouton()
      expect(showCrouton.value).toBe(false)
    })

    it('loading is notLoading when no states', () => {
      const { loading } = useCrouton()
      expect(loading.value).toBe('notLoading')
    })

    it('action is undefined when no states', () => {
      const { action } = useCrouton()
      expect(action.value).toBeUndefined()
    })

    it('activeCollection is null when no states', () => {
      const { activeCollection } = useCrouton()
      expect(activeCollection.value).toBeNull()
    })

    it('items is empty array when no states', () => {
      const { items } = useCrouton()
      expect(items.value).toEqual([])
    })

    it('activeItem is empty object when no states', () => {
      const { activeItem } = useCrouton()
      expect(activeItem.value).toEqual({})
    })
  })

  describe('open()', () => {
    it('creates new state with create action', async () => {
      const { open, croutonStates, showCrouton } = useCrouton()

      await open('create', 'products')

      expect(croutonStates.value).toHaveLength(1)
      expect(croutonStates.value[0]!.action).toBe('create')
      expect(croutonStates.value[0]!.collection).toBe('products')
      expect(croutonStates.value[0]!.isOpen).toBe(true)
      expect(showCrouton.value).toBe(true)
    })

    it('creates state with correct id format', async () => {
      const { open, croutonStates } = useCrouton()

      await open('create', 'products')

      expect(croutonStates.value[0]!.id).toMatch(/^crouton-\d+-\d+/)
    })

    it('sets containerType to slideover by default', async () => {
      const { open, croutonStates } = useCrouton()

      await open('create', 'products')

      expect(croutonStates.value[0]!.containerType).toBe('slideover')
    })

    it('respects custom container type', async () => {
      const { open, croutonStates } = useCrouton()

      await open('create', 'products', [], 'modal')

      expect(croutonStates.value[0]!.containerType).toBe('modal')
    })

    it('sets initialData for create action', async () => {
      const { open, croutonStates } = useCrouton()
      const initialData = { name: 'Test Product', price: 100 }

      await open('create', 'products', [], 'slideover', initialData)

      expect(croutonStates.value[0]!.activeItem).toEqual(initialData)
    })

    it('sets items for delete action', async () => {
      const { open, croutonStates } = useCrouton()
      const ids = ['id1', 'id2', 'id3']

      await open('delete', 'products', ids)

      expect(croutonStates.value[0]!.items).toEqual(ids)
    })

    it('blocks open when errors exist', async () => {
      mockFoundErrors.mockReturnValue(true)
      const { open, croutonStates } = useCrouton()

      await open('create', 'products')

      expect(croutonStates.value).toHaveLength(0)
    })

    it('respects MAX_DEPTH limit of 5', async () => {
      const { open, croutonStates } = useCrouton()

      // Open 5 modals
      for (let i = 0; i < 5; i++) {
        await open('create', 'products')
      }
      expect(croutonStates.value).toHaveLength(5)

      // Try to open 6th - should be blocked
      await open('create', 'products')
      expect(croutonStates.value).toHaveLength(5)
      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Maximum depth reached',
        description: 'Cannot open more than 5 nested forms',
        icon: 'i-lucide-alert-triangle',
        color: 'warning'
      })
    })
  })

  describe('open() with update/view fetch', () => {
    it('fetches item data for update action', async () => {
      const mockItem = { id: 'prod-1', name: 'Test Product' }
      mockFetch.mockResolvedValue(mockItem)

      const { open, croutonStates } = useCrouton()

      await open('update', 'products', ['prod-1'])

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products',
        expect.objectContaining({
          method: 'GET',
          query: { ids: 'prod-1' }
        })
      )
      expect(croutonStates.value[0]!.activeItem).toEqual(mockItem)
    })

    it('handles multiple IDs in query format', async () => {
      const mockItems = [
        { id: 'prod-1', name: 'Product 1' },
        { id: 'prod-2', name: 'Product 2' },
        { id: 'prod-3', name: 'Product 3' }
      ]
      mockFetch.mockResolvedValue(mockItems)

      const { open, croutonStates } = useCrouton()

      // Open with multiple IDs (e.g., for bulk view/edit)
      await open('update', 'products', ['prod-1', 'prod-2', 'prod-3'])

      // Verify the query format for multiple IDs - comma-separated
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products',
        expect.objectContaining({
          method: 'GET',
          query: { ids: 'prod-1,prod-2,prod-3' } // IDs joined with comma
        })
      )

      // For update action, activeItem is set to first item from response
      expect(croutonStates.value[0]!.activeItem).toEqual(mockItems[0])
    })

    it('stores IDs in items array for delete action', async () => {
      const { open, croutonStates } = useCrouton()

      // For delete action, items array is populated with IDs
      await open('delete', 'products', ['prod-1', 'prod-2', 'prod-3'])

      // Items array should contain all passed IDs for delete
      expect(croutonStates.value[0]!.items).toEqual(['prod-1', 'prod-2', 'prod-3'])
      // No activeItem for delete action
      expect(croutonStates.value[0]!.activeItem).toEqual({})
    })

    it('uses RESTful path for restful fetchStrategy', async () => {
      const mockItem = { id: 'post-1', title: 'Test Post' }
      mockFetch.mockResolvedValue(mockItem)

      const { open } = useCrouton()

      await open('update', 'posts', ['post-1'])

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/teams/test-team/posts/post-1',
        expect.objectContaining({
          method: 'GET',
          query: {}
        })
      )
    })

    it('uses super-admin path for admin routes', async () => {
      mockRoute = {
        path: '/super-admin/products',
        params: {}
      }
      const mockItem = { id: 'prod-1', name: 'Test' }
      mockFetch.mockResolvedValue(mockItem)

      const { open } = useCrouton()

      await open('update', 'products', ['prod-1'])

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/super-admin/shop-products',
        expect.any(Object)
      )
    })

    it('handles paginated response', async () => {
      const paginatedResponse = {
        items: [{ id: 'prod-1', name: 'Product 1' }],
        pagination: { totalItems: 1, currentPage: 1 }
      }
      mockFetch.mockResolvedValue(paginatedResponse)

      const { open, croutonStates } = useCrouton()

      await open('update', 'products', ['prod-1'])

      expect(croutonStates.value[0]!.activeItem).toEqual({ id: 'prod-1', name: 'Product 1' })
    })

    it('shows toast on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { open, croutonStates } = useCrouton()

      await open('update', 'products', ['prod-1'])

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Uh oh! Something went wrong.',
        description: 'Error: Network error',
        icon: 'i-lucide-octagon-alert',
        color: 'error'
      })
      expect(croutonStates.value).toHaveLength(0)
    })
  })

  describe('nested modals', () => {
    it('allows opening multiple modals up to MAX_DEPTH', async () => {
      mockFetch.mockResolvedValue({ id: 'id1', name: 'Test' })
      const { open, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('create', 'posts')
      await open('update', 'products', ['id1'])

      expect(croutonStates.value).toHaveLength(3)
    })

    it('tracks each modal state independently', async () => {
      mockFetch.mockResolvedValue({ id: 'prod-1', name: 'Test' })

      const { open, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('update', 'posts', ['post-1'])

      expect(croutonStates.value[0]!.action).toBe('create')
      expect(croutonStates.value[0]!.collection).toBe('products')
      expect(croutonStates.value[1]!.action).toBe('update')
      expect(croutonStates.value[1]!.collection).toBe('posts')
    })
  })

  describe('close()', () => {
    it('sets isOpen to false on topmost state', async () => {
      const { open, close, croutonStates } = useCrouton()

      await open('create', 'products')
      expect(croutonStates.value[0]!.isOpen).toBe(true)

      close()
      expect(croutonStates.value[0]!.isOpen).toBe(false)
    })

    it('closes specific state by id', async () => {
      const { open, close, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('create', 'posts')

      const firstStateId = croutonStates.value[0]!.id

      close(firstStateId)

      expect(croutonStates.value[0]!.isOpen).toBe(false)
      expect(croutonStates.value[1]!.isOpen).toBe(true)
    })
  })

  describe('removeState()', () => {
    it('removes state from array by id', async () => {
      const { open, removeState, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('create', 'posts')

      const firstStateId = croutonStates.value[0]!.id
      removeState(firstStateId)

      expect(croutonStates.value).toHaveLength(1)
      expect(croutonStates.value[0]!.collection).toBe('posts')
    })
  })

  describe('closeAll()', () => {
    it('sets all states to closed', async () => {
      vi.useFakeTimers()

      const { open, closeAll, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('create', 'posts')

      closeAll()

      expect(croutonStates.value[0]!.isOpen).toBe(false)
      expect(croutonStates.value[1]!.isOpen).toBe(false)

      // After timeout, clears all states
      vi.advanceTimersByTime(300)
      expect(croutonStates.value).toHaveLength(0)

      vi.useRealTimers()
    })
  })

  describe('reset()', () => {
    it('immediately clears all states', async () => {
      const { open, reset, croutonStates } = useCrouton()

      await open('create', 'products')
      await open('create', 'posts')
      expect(croutonStates.value).toHaveLength(2)

      reset()
      expect(croutonStates.value).toHaveLength(0)
    })
  })

  describe('pagination', () => {
    it('setPagination merges with existing pagination', () => {
      const { setPagination, getPagination } = useCrouton()

      setPagination('products', { currentPage: 2, pageSize: 20 })

      const pagination = getPagination('products')
      expect(pagination.currentPage).toBe(2)
      expect(pagination.pageSize).toBe(20)
      expect(pagination.sortBy).toBe('createdAt') // Default
      expect(pagination.sortDirection).toBe('desc') // Default
    })

    it('getPagination returns defaults for unknown collection', () => {
      const { getPagination } = useCrouton()

      const pagination = getPagination('unknown-collection')

      expect(pagination.currentPage).toBe(1)
      expect(pagination.pageSize).toBe(10)
      expect(pagination.sortBy).toBe('createdAt')
      expect(pagination.sortDirection).toBe('desc')
    })

    it('getDefaultPagination uses collection config defaults', () => {
      // Add a collection with custom default pagination
      mockCollectionsConfig.customCollection = {
        defaultPagination: {
          currentPage: 1,
          pageSize: 50,
          sortBy: 'name',
          sortDirection: 'asc'
        }
      }

      const { getDefaultPagination } = useCrouton()

      const pagination = getDefaultPagination('customCollection')
      expect(pagination.pageSize).toBe(50)
      expect(pagination.sortBy).toBe('name')
      expect(pagination.sortDirection).toBe('asc')
    })

    it('getDefaultPagination falls back to global defaults', () => {
      const { getDefaultPagination } = useCrouton()

      const pagination = getDefaultPagination('products')

      expect(pagination.currentPage).toBe(1)
      expect(pagination.pageSize).toBe(10)
      expect(pagination.sortBy).toBe('createdAt')
      expect(pagination.sortDirection).toBe('desc')
    })
  })

  describe('computed values reflect topmost state', () => {
    it('loading reflects topmost state loading', async () => {
      const { open, loading, croutonStates } = useCrouton()

      await open('create', 'products')
      expect(loading.value).toBe('notLoading')

      // Manually set loading state to test computed
      croutonStates.value[0]!.loading = 'create_send'
      expect(loading.value).toBe('create_send')
    })

    it('action reflects topmost state action', async () => {
      const { open, action } = useCrouton()

      await open('create', 'products')
      expect(action.value).toBe('create')

      await open('delete', 'posts', ['id1'])
      expect(action.value).toBe('delete')
    })

    it('activeCollection reflects topmost state collection', async () => {
      const { open, activeCollection } = useCrouton()

      await open('create', 'products')
      expect(activeCollection.value).toBe('products')

      await open('create', 'posts')
      expect(activeCollection.value).toBe('posts')
    })
  })
})
