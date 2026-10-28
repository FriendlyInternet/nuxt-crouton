import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

// Mock collections config
let mockCollectionsConfig: Record<string, any> = {}

// Set up global mocks
vi.stubGlobal('reactive', reactive)

vi.stubGlobal('useAppConfig', () => ({
  croutonCollections: mockCollectionsConfig
}))

// Import after mocking
import useCollections from '../useCollections'

describe('useCollections', () => {
  beforeEach(() => {
    // Reset mock config
    mockCollectionsConfig = {
      products: {
        layer: 'shop',
        apiPath: 'shop-products',
        references: { categoryId: 'categories' }
      },
      posts: {
        layer: 'blog',
        references: { authorId: 'users' },
        dependentFieldComponents: { tags: 'TagsSelector' }
      },
      users: {},
      categories: {
        layer: 'shop',
        hierarchy: {
          enabled: true,
          parentField: 'parentId',
          pathField: 'path'
        }
      },
      tasks: {
        sortable: {
          enabled: true,
          orderField: 'position'
        }
      }
    }
  })

  describe('getConfig', () => {
    it('returns config for registered collection', () => {
      const { getConfig } = useCollections()

      const config = getConfig('products')

      expect(config).toBeDefined()
      expect(config?.layer).toBe('shop')
    })

    it('returns undefined for unregistered collection', () => {
      const { getConfig } = useCollections()

      const config = getConfig('nonexistent')

      expect(config).toBeUndefined()
    })

    it('returns apiPath from config', () => {
      const { getConfig } = useCollections()

      const config = getConfig('products')

      expect(config?.apiPath).toBe('shop-products')
    })

    it('returns references from config', () => {
      const { getConfig } = useCollections()

      const config = getConfig('posts')

      expect(config?.references).toEqual({ authorId: 'users' })
    })

    it('returns hierarchy config', () => {
      const { getConfig } = useCollections()

      const config = getConfig('categories')

      expect(config?.hierarchy?.enabled).toBe(true)
      expect(config?.hierarchy?.parentField).toBe('parentId')
    })

    it('returns sortable config', () => {
      const { getConfig } = useCollections()

      const config = getConfig('tasks')

      expect(config?.sortable?.enabled).toBe(true)
      expect(config?.sortable?.orderField).toBe('position')
    })
  })

  describe('dependentFieldComponentMap', () => {
    it('builds map from configs with dependentFieldComponents', () => {
      const { dependentFieldComponentMap } = useCollections()

      expect(dependentFieldComponentMap.posts).toEqual({ tags: 'TagsSelector' })
    })

    it('excludes collections without dependent components', () => {
      const { dependentFieldComponentMap } = useCollections()

      expect(dependentFieldComponentMap.products).toBeUndefined()
      expect(dependentFieldComponentMap.users).toBeUndefined()
    })
  })

  describe('configs', () => {
    it('exposes full registry', () => {
      const { configs } = useCollections()

      expect(configs).toEqual(mockCollectionsConfig)
    })

    it('contains all registered collections', () => {
      const { configs } = useCollections()

      expect(Object.keys(configs)).toContain('products')
      expect(Object.keys(configs)).toContain('posts')
      expect(Object.keys(configs)).toContain('users')
    })
  })

  describe('edge cases', () => {
    it('handles empty config', () => {
      mockCollectionsConfig = {}

      const { getConfig, configs } = useCollections()

      expect(getConfig('anything')).toBeUndefined()
      expect(Object.keys(configs)).toHaveLength(0)
    })

    it('handles config with partial data', () => {
      mockCollectionsConfig = {
        minimal: {} // No properties set
      }

      const { getConfig } = useCollections()

      const config = getConfig('minimal')
      expect(config).toBeDefined()
      expect(config?.layer).toBeUndefined()
    })

    it('handles null croutonCollections gracefully', () => {
      // Override useAppConfig to return null
      vi.stubGlobal('useAppConfig', () => ({
        croutonCollections: null
      }))

      // This should not throw
      expect(() => useCollections()).not.toThrow()
    })
  })
})
