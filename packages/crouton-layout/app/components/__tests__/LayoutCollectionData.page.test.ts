/**
 * Page context renders each display variant as its own markup (#3812).
 *
 * Before: `table` fell into the same `<ul>` row list as `list` on a served page
 * (and the builder board's live card), so a block set to "table" only looked
 * like a table in the editor. Contract: list → rows, grid → cards, table → a
 * real `<table>` at content height (sideways scroll only), keeping load-more and
 * the empty state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed, defineComponent, h, ref, Suspense } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import LayoutCollectionData from '../LayoutCollectionData.vue'

let items: any[] = []
let declared: any[] = []
let recorded: any = null

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `a${i}`, name: `Artist ${i}` }))
}

beforeEach(() => {
  items = rowsOf(12)
  declared = [{ accessorKey: 'name', header: 'Name' }]
  recorded = null
  vi.stubGlobal('useCollectionQuery', async () => ({ items: ref(items), pending: ref(false) }))
  vi.stubGlobal('useCollections', () => ({ getConfig: () => ({ columns: declared }) }))
  vi.stubGlobal('useTableColumns', (o: any) => {
    recorded = o
    return { allColumns: computed(() => o.columns) }
  })
})
afterEach(() => vi.unstubAllGlobals())

const UTable = defineComponent({
  name: 'UTable',
  props: { data: { type: Array, default: () => [] }, columns: { type: Array, default: () => [] } },
  setup: p => () => h('table', [h('tbody', (p.data as any[]).map(r => h('tr', { key: r.id }, r.name)))])
})

const stubs = {
  CroutonDefaultCard: defineComponent({
    props: { layout: String, item: Object, collection: String },
    setup: p => () => h('div', { class: `card-${p.layout}` })
  }),
  UTable,
  UButton: defineComponent({ setup: (_, { slots, attrs }) => () => h('button', attrs, slots.default?.()) }),
  UInput: defineComponent({ setup: () => () => h('input') }),
  UPagination: defineComponent({ setup: () => () => h('nav') }),
  CroutonCollection: defineComponent({ setup: () => () => h('div') })
}

async function render(layout: 'list' | 'grid' | 'table') {
  const Host = defineComponent({
    render: () => h(Suspense, null, {
      default: () => h(LayoutCollectionData, { collection: 'artists', layout, context: 'page' })
    })
  })
  const w = mount(Host, { global: { stubs } })
  await flushPromises()
  return w
}

describe('LayoutCollectionData page context (#3812)', () => {
  it('list renders the row list', async () => {
    const w = await render('list')
    expect(w.findAll('ul[role=list] > li')).toHaveLength(10)
    expect(w.find('table').exists()).toBe(false)
    expect(w.find('.card-grid').exists()).toBe(false)
  })

  it('grid renders cards', async () => {
    const w = await render('grid')
    expect(w.findAll('.card-grid')).toHaveLength(10)
    expect(w.find('ul').exists()).toBe(false)
    expect(w.find('table').exists()).toBe(false)
  })

  it('table renders a <table>', async () => {
    const w = await render('table')
    expect(w.findAll('[data-handoff=collection-table] table tr')).toHaveLength(10)
    expect(w.find('ul[role=list]').exists()).toBe(false)
    expect(w.find('.card-grid').exists()).toBe(false)
  })

  it('table keeps load-more', async () => {
    const w = await render('table')
    const btn = w.find('button')
    expect(btn.text()).toContain('Load more (2 more)')
    await btn.trigger('click')
    expect(w.findAll('table tr')).toHaveLength(12)
    expect(w.find('button').exists()).toBe(false)
  })

  it('table wrapper is content-height', async () => {
    const w = await render('table')
    const cls = w.find('[data-handoff=collection-table]').classes()
    expect(cls).toContain('overflow-x-auto')
    expect(cls).not.toContain('h-full')
    expect(cls.some(c => c.startsWith('overflow-y'))).toBe(false)
    expect(cls).not.toContain('overflow-auto')
  })

  it('table hides select + actions columns', async () => {
    await render('table')
    expect(recorded.hideDefaultColumns.select).toBe(true)
    expect(recorded.hideDefaultColumns.actions).toBe(true)
  })

  it('empty collection keeps the empty state for table', async () => {
    items = []
    const w = await render('table')
    expect(w.find('[data-handoff=collection-empty]').exists()).toBe(true)
    expect(w.find('table').exists()).toBe(false)
  })

  it('table columns are typed for UTable', async () => {
    declared = [{ header: 'X' }, { accessorKey: 'name', header: 'Name' }]
    const w = await render('table')
    const cols = w.findComponent(UTable).props('columns') as any[]
    expect(cols).toHaveLength(2)
    for (const c of cols) expect(Boolean(c.id || c.accessorKey)).toBe(true)
  })
})
