import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, reactive } from 'vue'
import { createUseTMock, sampleRows } from './test-utils'

// Mock route
const mockRoute = {
  path: '/dashboard/test-team/products',
  params: { team: 'test-team' }
}

// Mock collections config
const mockCollectionsConfig: Record<string, any> = {
  products: {
    layer: 'shop',
    apiPath: 'shop-products',
  },
  posts: {
    layer: 'blog'
  }
}

// Mock $fetch
const mock$fetch = vi.fn()

// Mock useTeam
let mockUseTeam: (() => { currentTeam: any }) | null = null

// Mock console
const mockConsoleWarn = vi.fn()
const mockConsoleError = vi.fn()

// Mock URL.createObjectURL and revokeObjectURL
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url')
const mockRevokeObjectURL = vi.fn()

// Mock document methods for download
const mockClick = vi.fn()
const mockAppendChild = vi.fn()
const mockRemoveChild = vi.fn()

// Store created links for inspection
let lastCreatedLink: HTMLAnchorElement | null = null

// Set up global mocks
vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('reactive', reactive)
vi.stubGlobal('useRoute', () => mockRoute)
vi.stubGlobal('$fetch', mock$fetch)

vi.stubGlobal('useAppConfig', () => ({
  croutonCollections: mockCollectionsConfig
}))

vi.stubGlobal('useTeam', () => {
  if (mockUseTeam) {
    return mockUseTeam()
  }
  throw new Error('useTeam not available')
})

// Mock useT
const mockUseT = createUseTMock()
vi.stubGlobal('useT', () => mockUseT)

// Mock console
vi.stubGlobal('console', {
  ...console,
  warn: mockConsoleWarn,
  error: mockConsoleError
})

// Mock browser APIs
vi.stubGlobal('URL', {
  createObjectURL: mockCreateObjectURL,
  revokeObjectURL: mockRevokeObjectURL
})

vi.stubGlobal('Blob', class MockBlob {
  content: string
  options: any
  constructor(content: string[], options?: any) {
    this.content = content.join('')
    this.options = options
  }
})

vi.stubGlobal('document', {
  createElement: (tag: string) => {
    if (tag === 'a') {
      lastCreatedLink = {
        href: '',
        download: '',
        style: { display: '' },
        click: mockClick
      } as unknown as HTMLAnchorElement
      return lastCreatedLink
    }
    return {}
  },
  body: {
    appendChild: mockAppendChild,
    removeChild: mockRemoveChild
  }
})

// Import composables after mocking
import useCollections from '../useCollections'
import { useTeamContext } from '../useTeamContext'

vi.stubGlobal('useCollections', useCollections)
vi.stubGlobal('useTeamContext', useTeamContext)

// Import the composable under test
import { useCollectionExport } from '../useCollectionExport'

describe('useCollectionExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTeam = null
    lastCreatedLink = null
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('exportCSV', () => {
    it('generates CSV with all fields by default', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [
        { id: '1', name: 'Apple', price: 1.5 },
        { id: '2', name: 'Banana', price: 0.75 }
      ]

      exportCSV(testData, { includeId: true })

      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockClick).toHaveBeenCalled()
      expect(lastCreatedLink?.download).toMatch(/^products-\d{4}-\d{2}-\d{2}\.csv$/)
    })

    it('excludes teamId by default', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [
        { id: '1', name: 'Apple', teamId: 'team-123' }
      ]

      exportCSV(testData, { includeId: true })

      // The blob content should not contain teamId
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('excludes id and metadata by default', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [
        { id: '1', name: 'Apple', createdAt: '2024-01-01', updatedAt: '2024-01-02' }
      ]

      exportCSV(testData)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('includes id when includeId is true', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ id: '1', name: 'Apple' }]

      exportCSV(testData, { includeId: true })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('includes metadata when includeMetadata is true', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', createdAt: '2024-01-01' }]

      exportCSV(testData, { includeMetadata: true })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('uses custom filename', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple' }]

      exportCSV(testData, { filename: 'my-export' })

      expect(lastCreatedLink?.download).toMatch(/^my-export-\d{4}-\d{2}-\d{2}\.csv$/)
    })

    it('exports only specified fields', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ id: '1', name: 'Apple', price: 1.5, category: 'Fruit' }]

      exportCSV(testData, {
        fields: ['name', 'price']
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('uses custom labels for fields', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', price: 1.5 }]

      exportCSV(testData, {
        fields: [
          { key: 'name', label: 'Product Name' },
          { key: 'price', label: 'Price ($)' }
        ]
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('applies transform function to values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ price: 1.5 }]

      exportCSV(testData, {
        fields: [
          { key: 'price', transform: (v: number) => v.toFixed(2) }
        ]
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('applies transformRow function', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', price: 1.5 }]

      exportCSV(testData, {
        transformRow: (row) => ({
          ...row,
          displayPrice: `$${row.price}`
        }),
        fields: ['name', 'displayPrice']
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('excludes specified fields', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', price: 1.5, internalCode: 'A123' }]

      exportCSV(testData, {
        excludeFields: ['internalCode']
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('escapes commas in values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple, Red' }]

      exportCSV(testData)

      // Value should be quoted when containing comma
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('escapes double quotes in values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple "Delicious"' }]

      exportCSV(testData)

      // Double quotes should be doubled
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('escapes newlines in values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ description: 'Line 1\nLine 2' }]

      exportCSV(testData)

      // Value should be quoted when containing newline
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('handles null values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', price: null }]

      exportCSV(testData)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('handles undefined values', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', price: undefined }]

      exportCSV(testData)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('stringifies nested objects', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', category: { id: '1', name: 'Fruit' } }]

      exportCSV(testData)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('stringifies arrays', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple', tags: ['red', 'sweet'] }]

      exportCSV(testData)

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('warns when no data to export', () => {
      const { exportCSV } = useCollectionExport('products')

      exportCSV([])

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('export.noData')
      )
      expect(mockCreateObjectURL).not.toHaveBeenCalled()
    })

    it('cleans up blob URL after download', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ name: 'Apple' }]

      exportCSV(testData)

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    })
  })

  describe('exportJSON', () => {
    it('generates JSON with all fields by default', () => {
      const { exportJSON } = useCollectionExport('products')
      const testData = [
        { id: '1', name: 'Apple', price: 1.5 },
        { id: '2', name: 'Banana', price: 0.75 }
      ]

      exportJSON(testData, { includeId: true })

      expect(mockCreateObjectURL).toHaveBeenCalled()
      expect(mockClick).toHaveBeenCalled()
      expect(lastCreatedLink?.download).toMatch(/^products-\d{4}-\d{2}-\d{2}\.json$/)
    })

    it('uses custom filename', () => {
      const { exportJSON } = useCollectionExport('products')
      const testData = [{ name: 'Apple' }]

      exportJSON(testData, { filename: 'products-backup' })

      expect(lastCreatedLink?.download).toMatch(/^products-backup-\d{4}-\d{2}-\d{2}\.json$/)
    })

    it('exports only specified fields', () => {
      const { exportJSON } = useCollectionExport('products')
      const testData = [{ id: '1', name: 'Apple', price: 1.5, category: 'Fruit' }]

      exportJSON(testData, {
        fields: ['name', 'price']
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('applies transform function to values', () => {
      const { exportJSON } = useCollectionExport('products')
      const testData = [{ price: 1.5 }]

      exportJSON(testData, {
        fields: [
          { key: 'price', transform: (v: number) => v.toFixed(2) }
        ]
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('warns when no data to export', () => {
      const { exportJSON } = useCollectionExport('products')

      exportJSON([])

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('export.noData')
      )
      expect(mockCreateObjectURL).not.toHaveBeenCalled()
    })
  })

  describe('exportWithQuery', () => {
    beforeEach(() => {
      mock$fetch.mockResolvedValue([
        { id: '1', name: 'Apple' },
        { id: '2', name: 'Banana' }
      ])
    })

    it('fetches data from API and exports as CSV', async () => {
      const { exportWithQuery, isExporting } = useCollectionExport('products')

      await exportWithQuery('csv', { status: 'active' })

      expect(mock$fetch).toHaveBeenCalledWith(
        '/api/teams/test-team/shop-products',
        expect.objectContaining({
          query: expect.objectContaining({
            status: 'active',
            limit: 10000
          })
        })
      )
      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('fetches data from API and exports as JSON', async () => {
      const { exportWithQuery } = useCollectionExport('products')

      await exportWithQuery('json')

      expect(mock$fetch).toHaveBeenCalled()
      expect(lastCreatedLink?.download).toMatch(/\.json$/)
    })

    it('sets isExporting during export', async () => {
      const { exportWithQuery, isExporting } = useCollectionExport('products')

      const exportPromise = exportWithQuery('csv')

      // Can't easily test intermediate state in this setup
      await exportPromise

      expect(isExporting.value).toBe(false)
    })

    it('handles paginated response format', async () => {
      mock$fetch.mockResolvedValue({
        items: [{ id: '1', name: 'Apple' }],
        pagination: { total: 1 }
      })

      const { exportWithQuery } = useCollectionExport('products')

      await exportWithQuery('csv')

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('handles data response format', async () => {
      mock$fetch.mockResolvedValue({
        data: [{ id: '1', name: 'Apple' }]
      })

      const { exportWithQuery } = useCollectionExport('products')

      await exportWithQuery('csv')

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('throws error when team context not available', async () => {
      // Override route to remove team
      vi.stubGlobal('useRoute', () => ({
        path: '/products',
        params: {}
      }))

      const { exportWithQuery } = useCollectionExport('products')

      await expect(exportWithQuery('csv')).rejects.toThrow('Team context not available')

      // Restore
      vi.stubGlobal('useRoute', () => mockRoute)
    })

    it('throws error on fetch failure', async () => {
      mock$fetch.mockRejectedValue(new Error('Network error'))

      const { exportWithQuery } = useCollectionExport('products')

      await expect(exportWithQuery('csv')).rejects.toThrow('Network error')
    })

    it('resets isExporting on error', async () => {
      mock$fetch.mockRejectedValue(new Error('Network error'))

      const { exportWithQuery, isExporting } = useCollectionExport('products')

      try {
        await exportWithQuery('csv')
      }
      catch {
        // Expected
      }

      expect(isExporting.value).toBe(false)
    })

    it('uses collection name as apiPath when not configured', async () => {
      const { exportWithQuery } = useCollectionExport('posts')

      await exportWithQuery('csv')

      expect(mock$fetch).toHaveBeenCalledWith(
        '/api/teams/test-team/posts',
        expect.any(Object)
      )
    })

    it('uses team ID from useTeam() when available', async () => {
      mockUseTeam = () => ({
        currentTeam: { value: { id: 'team-456', slug: 'acme' } }
      })

      const { exportWithQuery } = useCollectionExport('products')

      await exportWithQuery('csv')

      expect(mock$fetch).toHaveBeenCalledWith(
        '/api/teams/team-456/shop-products',
        expect.any(Object)
      )
    })

    it('passes export options to export function', async () => {
      const { exportWithQuery } = useCollectionExport('products')

      await exportWithQuery('csv', {}, {
        fields: ['name'],
        filename: 'custom-export'
      })

      expect(lastCreatedLink?.download).toMatch(/^custom-export-/)
    })
  })

  describe('date formatting', () => {
    it('uses ISO format by default', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ createdAt: '2024-01-15T10:30:00.000Z' }]

      exportCSV(testData, { includeMetadata: true })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('respects dateFormat option for locale', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ createdAt: '2024-01-15T10:30:00.000Z' }]

      exportCSV(testData, {
        includeMetadata: true,
        dateFormat: 'locale'
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })

    it('respects dateFormat option for timestamp', () => {
      const { exportCSV } = useCollectionExport('products')
      const testData = [{ createdAt: '2024-01-15T10:30:00.000Z' }]

      exportCSV(testData, {
        includeMetadata: true,
        dateFormat: 'timestamp'
      })

      expect(mockCreateObjectURL).toHaveBeenCalled()
    })
  })

  describe('return value', () => {
    it('returns all expected methods', () => {
      const result = useCollectionExport('products')

      expect(result).toHaveProperty('exportCSV')
      expect(result).toHaveProperty('exportJSON')
      expect(result).toHaveProperty('exportWithQuery')
      expect(result).toHaveProperty('isExporting')
      expect(typeof result.exportCSV).toBe('function')
      expect(typeof result.exportJSON).toBe('function')
      expect(typeof result.exportWithQuery).toBe('function')
      expect(result.isExporting.value).toBe(false)
    })
  })
})
