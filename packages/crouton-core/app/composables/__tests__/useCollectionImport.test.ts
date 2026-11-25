import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, computed, reactive } from 'vue'

let mockPayloadData: Record<string, any> = {}
// Per-test mutable collection configs; `products` keeps its original config
let mockConfigs: Record<string, any> = {}
const mockRefreshNuxtData = vi.fn()
const mockFetch = vi.fn()

vi.stubGlobal('ref', ref)
vi.stubGlobal('computed', computed)
vi.stubGlobal('useRoute', () => ({ path: '/admin/team-a/products', params: { team: 'team-a' } }))
vi.stubGlobal('useTeam', () => ({ currentTeam: ref({ id: 'team-a' }) }))
vi.stubGlobal('useTeamContext', () => ({ getTeamId: () => 'team-a' }))
vi.stubGlobal('useCollections', () => ({
  getConfig: (name: string) => mockConfigs[name] ?? null
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
    mockConfigs = { products: { apiPath: 'shop-products' } }
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

// What the generator writes into the collection config (composable.ts template)
const generatedFields = () => [
  { name: 'title', type: 'string', label: 'Event Name' },
  { name: 'slug', type: 'string', label: 'URL Slug' }
]

describe('useCollectionImport — generated fields (#4511)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({ id: 'new' })
    mockPayloadData = {}
    mockConfigs = { events: { apiPath: 'sales-events', fields: generatedFields() } }
  })

  // covers: T1
  it('builds the field list from generated fields[].name and label', () => {
    const { getCollectionFields } = useCollectionImport('events')
    const fields = getCollectionFields()
    expect(fields.map(f => f.key)).toEqual(['title', 'slug'])
    expect(fields.map(f => f.label)).toEqual(['Event Name', 'URL Slug'])
  })

  // covers: T2
  it('maps columns by field name or by label', () => {
    const { getCollectionFields, autoMapColumns } = useCollectionImport('events')
    const fields = getCollectionFields()
    expect(autoMapColumns(['title', 'slug'], fields).map(m => m.fieldKey)).toEqual(['title', 'slug'])
    expect(autoMapColumns(['Event Name', 'URL Slug'], fields).map(m => m.fieldKey)).toEqual(['title', 'slug'])
  })

  // covers: T3
  it('takes required from a non-enumerable schema and labels from fields', () => {
    const config: any = { apiPath: 'sales-events', fields: generatedFields() }
    Object.defineProperty(config, 'schema', {
      enumerable: false,
      value: {
        shape: {
          title: { isOptional: () => false },
          slug: { isOptional: () => true }
        }
      }
    })
    mockConfigs.events = config
    const { getCollectionFields } = useCollectionImport('events')
    const fields = getCollectionFields()
    expect(fields.find(f => f.key === 'title')?.required).toBe(true)
    expect(fields.find(f => f.key === 'slug')?.required).toBe(false)
    expect(fields.map(f => f.label)).toEqual(['Event Name', 'URL Slug'])
  })

  // covers: T3 (real app shape: the config is reactive, which made reading schema throw)
  it('reads a non-configurable schema through a reactive config', () => {
    const raw: any = { apiPath: 'sales-events', fields: generatedFields() }
    Object.defineProperty(raw, 'schema', {
      enumerable: false,
      writable: false,
      configurable: false,
      value: { shape: { title: { isOptional: () => false }, slug: { isOptional: () => true } } }
    })
    mockConfigs.events = reactive(raw)
    const { getCollectionFields } = useCollectionImport('events')
    const fields = getCollectionFields()
    expect(fields.map(f => [f.key, f.required])).toEqual([['title', true], ['slug', false]])
  })

  // covers: T4
  it('records the failed row by its own index, or by the given rowIndexes', async () => {
    const rows = Array.from({ length: 25 }, (_, n) => ({ title: `r${n}` }))
    mockFetch.mockImplementation((_url: string, opts: any) =>
      opts.body.title === 'r21' ? Promise.reject(new Error('x')) : Promise.resolve({ id: 'new' })
    )
    const { executeImport } = useCollectionImport('events')
    const result = await executeImport(rows)
    expect(result.errors).toEqual([{ rowIndex: 21, error: 'x' }])

    mockFetch.mockImplementation((_url: string, opts: any) =>
      opts.body.title === 'b' ? Promise.reject(new Error('y')) : Promise.resolve({ id: 'new' })
    )
    const second = await executeImport([{ title: 'a' }, { title: 'b' }, { title: 'c' }], [0, 2, 5])
    expect(second.errors).toEqual([{ rowIndex: 2, error: 'y' }])
  })
})
