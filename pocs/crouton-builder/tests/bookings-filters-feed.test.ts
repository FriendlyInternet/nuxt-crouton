// @vitest-environment happy-dom
/**
 * #3651 (owner test of PR #4298) — "show cancelled" in the Filters pane shows the
 * cancelled bookings in the Bookings list pane, through the REAL path a composed
 * page uses:
 *
 *   booking-demo's `/admin/[team]/blocks` tree → `CroutonLayoutStoreScope` → the
 *   package's `LayoutRenderer` → `useLayoutLeafBinding` → the `bookings` layout
 *   store (`bookings-layout-store.ts`, its real `useBookingsList` + real
 *   `createBookingsStore`) → the real `Layout/Filters.vue` + `PanelFilters.vue`
 *   (its own dropdown items) and `Layout/List.vue`.
 *
 * Stubbed: the network (`useFetch` answers by URL with the rows the deployed
 * preview's `admin-bookings` returns), and the leaf UI widgets (`UDropdownMenu`
 * renders its checkbox items as buttons; `CroutonBookingsList` records the
 * bookings it is handed). The real endpoint + seed rows were checked on the
 * deployed preview (PR #4298 comment), which a happy-dom test can't reach.
 *
 * Lives here, not in crouton-bookings: a domain package must not import
 * crouton-layout (crouton-mcp-toolkit's boundary test); this app consumes both.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { collectLayoutStores } from '../../../packages/crouton-core/app/utils/layout-stores'
import LayoutRenderer from '../../../packages/crouton-layout/app/components/LayoutRenderer.vue'
import LayoutStoreScope from '../../../packages/crouton-layout/app/components/LayoutStoreScope.vue'
import LayoutFilters from '../../../packages/crouton-bookings/app/components/Layout/Filters.vue'
import LayoutList from '../../../packages/crouton-bookings/app/components/Layout/List.vue'
import LayoutLocations from '../../../packages/crouton-bookings/app/components/Layout/Locations.vue'
import { bookingsLayoutStore } from '../../../packages/crouton-bookings/app/utils/bookings-layout-store'

const TEAM = 'seed:org:test1'
const loc = (key: string) => `seed:bookings-location:test1:${key}`
// The rows the review team's admin-bookings returns (seed shape), plus one cancelled.
const ROWS = [
  { id: 'bk-0', date: '2026-11-24T09:00:00.000Z', status: 'confirmed', location: loc('center-court'), slot: ['slot-0900'], quantity: 1 },
  { id: 'bk-2', date: '2026-11-25T14:00:00.000Z', status: 'pending', location: loc('park-court'), slot: ['slot-1400'], quantity: 1 },
  { id: 'bk-5', date: '2026-11-24T00:00:00.000Z', status: 'cancelled', location: loc('kayak-rental'), slot: null, quantity: 1 },
]
const LOCATIONS = [
  { id: loc('center-court'), title: 'Center Court' },
  { id: loc('park-court'), title: 'Park Court' },
  { id: loc('kayak-rental'), title: 'Kayak Rental' },
]
const fetched: string[] = []

/** Nuxt's `useFetch`, answering by URL. */
function useFetchStub(url: () => string | null, opts: { default?: () => unknown } = {}) {
  const u = url()
  if (u) fetched.push(u)
  const data = ref<unknown>(
    u?.endsWith('/admin-bookings') ? ROWS
      : u?.endsWith('/customer-locations') ? LOCATIONS
        : opts.default?.() ?? null,
  )
  return { data, pending: ref(false), error: ref(null), refresh: async () => {} }
}

// booking-demo `/admin/[team]/blocks` — the filters / locations / list rail.
const tree: LayoutTree = {
  renderer: 'panes',
  root: {
    type: 'split',
    direction: 'vertical',
    children: [
      { type: 'leaf', blockId: 'bookings-filters', source: 'bookings', defaultSize: 30 },
      { type: 'leaf', blockId: 'bookings-locations', source: 'bookings', defaultSize: 30 },
      { type: 'leaf', blockId: 'bookings-list', source: 'bookings', defaultSize: 40 },
    ],
  } as any,
  sources: { bookings: { options: { scope: 'team' } } },
}

let registry: Record<string, { component: string }>
const listed = ref<string[] | null>(null)

const ListStub = defineComponent({
  name: 'CroutonBookingsList',
  props: ['bookings'],
  setup(p) {
    return () => {
      listed.value = (p.bookings ?? []).map((b: { id: string }) => b.id)
      return h('div', { 'data-stub': 'list' })
    }
  },
})
/** Renders each checkbox item as a button that toggles it, the way the real menu does. */
const DropdownStub = defineComponent({
  name: 'UDropdownMenu',
  props: ['items'],
  setup(p, { slots }) {
    return () => h('div', [
      slots.default?.(),
      ...(p.items as any[][]).flat().filter(i => i.type === 'checkbox').map(i =>
        h('button', { 'data-item': i.label, onClick: () => i.onUpdateChecked(!i.checked) }, i.label)),
    ])
  },
})
const Pass = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })

beforeAll(async () => {
  ;(globalThis as any).defineAppConfig = (c: unknown) => c
  registry = (await import('../../../packages/crouton-bookings/app/app.config')).default.croutonLayoutBlocks as any
})

beforeEach(() => {
  fetched.length = 0
  listed.value = null
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useFetch', useFetchStub)
  vi.stubGlobal('useTeam', () => ({ currentTeam: ref({ id: TEAM }), isAdmin: ref(true) }))
  vi.stubGlobal('useT', () => ({ t: (k: string) => k }))
  vi.stubGlobal('useNotify', () => ({ warning: () => {} }))
  vi.stubGlobal('useCrouton', () => ({ open: () => {} }))
  vi.stubGlobal('useBookingCart', () => ({ lastBookingCreatedAt: ref(0) }))
  vi.stubGlobal('useCroutonLayoutStoreRegistry', () => ({ get: (id: string) => (id === 'bookings' ? bookingsLayoutStore : undefined) }))
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(registry),
    resolveComponentName: (id: string) => registry[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
})
afterEach(() => vi.unstubAllGlobals())

async function mountPage() {
  // PanelFilters calls the auto-imported `computed` at setup; import it after the globals are set.
  const PanelFilters = (await import('../../../packages/crouton-bookings/app/components/PanelFilters.vue')).default
  const Page = defineComponent({
    setup: () => () => h(LayoutStoreScope, { stores: collectLayoutStores(tree) }, () =>
      h(LayoutRenderer, { node: tree.root, interactive: false })),
  })
  const w = mount(Page, {
    global: {
      components: {
        CroutonLayoutRenderer: LayoutRenderer,
        CroutonLayoutCollapseHandle: defineComponent({ render: () => null }),
        CroutonBookingsLayoutFilters: LayoutFilters,
        CroutonBookingsLayoutList: LayoutList,
        CroutonBookingsLayoutLocations: LayoutLocations,
        CroutonBookingsPanelFilters: PanelFilters,
        CroutonBookingsList: ListStub,
        UDropdownMenu: DropdownStub,
        UChip: Pass,
        UButton: Pass,
        UFieldGroup: Pass,
        UIcon: defineComponent({ render: () => h('i') }),
      },
    },
  })
  await nextTick()
  return w
}

describe('composed bookings page: Filters → store → List (#3651)', () => {
  // covers: T4
  it('the store loads the team\'s admin-bookings, and the list hides cancelled bookings at first', async () => {
    const w = await mountPage()
    expect(fetched).toContain(`/api/crouton-bookings/teams/${TEAM}/admin-bookings`)
    expect(listed.value).toEqual(['bk-0', 'bk-2'])
    w.unmount()
  })

  // covers: T4
  it('switching on "show cancelled" in the Filters pane shows the cancelled booking in the List pane; off hides it again', async () => {
    const w = await mountPage()
    const toggle = w.find('[data-item="bookings.filters.cancelled"]')
    expect(toggle.exists()).toBe(true)

    await toggle.trigger('click')
    await nextTick()
    expect(listed.value).toEqual(['bk-5', 'bk-0', 'bk-2'])

    await w.find('[data-item="bookings.filters.cancelled"]').trigger('click')
    await nextTick()
    expect(listed.value).toEqual(['bk-0', 'bk-2'])
    w.unmount()
  })

  // covers: T4
  it('picking a location in the Filters pane narrows the List pane', async () => {
    const w = await mountPage()
    await w.find('[data-item="Park Court"]').trigger('click')
    await nextTick()
    expect(listed.value).toEqual(['bk-2'])
    w.unmount()
  })
})
