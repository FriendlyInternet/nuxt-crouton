/**
 * The phone stall on booking-demo's blocks page (#3753): at 390 px the bookings blocks showed
 * "No locations yet" and every bookings fetch sat at `pending`.
 *
 * Mechanism (seen on staging, 11 Nov: 14,325 bookings requests in ~80 s, none landing): the
 * renderer swapped the root split between the stacked column and the USplitter ~10×/s. Every swap
 * unmounts every pane. When the last component using a `useFetch` key unmounts, Nuxt's
 * `asyncData._off` cancels the request in flight ("AsyncData request cancelled by unmount"). The
 * new pane starts a new request, which the next swap cancels too. A request that takes longer than
 * one swap never lands, so the status stays `pending`. Widening stops the swaps, so the next
 * request completes. This is why the stall and the resize loop are the same bug.
 *
 * Real Nuxt runtime: real `useFetch` / `useAsyncData`, a real endpoint (`registerEndpoint`) that
 * answers after 50 ms, and the real `LayoutRenderer`. Two stand-ins, because the Nuxt test env has
 * no layout engine and no Nuxt UI: a ResizeObserver that reports a 361 px content box (happy-dom
 * measures every element as 0 px), and a plain USplitter stub (the same one the happy-dom
 * stack-settle test uses). `useFetch` is NOT mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import type { LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import LayoutRenderer from '../../app/components/LayoutRenderer.vue'

let hits = 0
registerEndpoint('/api/test-bookings/locations', async () => {
  hits++
  await new Promise(r => setTimeout(r, 50))
  return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
})

const registry: CroutonLayoutBlockRegistry = {
  'bookings-calendar-only': { id: 'bookings-calendar-only', name: 'Calendar', description: '', icon: '', component: 'TestCalendar', minWidth: 460 },
  'bookings-filters': { id: 'bookings-filters', name: 'Filters', description: '', icon: '', component: 'TestFilters', minWidth: 240 },
  'bookings-locations': { id: 'bookings-locations', name: 'Locations', description: '', icon: '', component: 'TestLocations', minWidth: 220 },
  'bookings-list': { id: 'bookings-list', name: 'List', description: '', icon: '', component: 'TestList', minWidth: 300 },
}

// booking-demo's blocks tree (`pocs/booking-demo/app/pages/admin/[team]/blocks.vue`).
const tree: LayoutSplit = {
  type: 'split',
  direction: 'horizontal',
  children: [
    { type: 'leaf', blockId: 'bookings-calendar-only', defaultSize: 62 },
    {
      type: 'split',
      direction: 'vertical',
      defaultSize: 38,
      children: [
        { type: 'leaf', blockId: 'bookings-filters', defaultSize: 30 },
        { type: 'leaf', blockId: 'bookings-locations', defaultSize: 30 },
        { type: 'leaf', blockId: 'bookings-list', defaultSize: 40 },
      ],
    },
  ],
}

// Reports `currentWidth` on the next macrotask after `observe`, as a real observer does on attach.
let currentWidth = 361
class FakeRO {
  targets = new Set<Element>()
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    this.targets.add(el)
    setTimeout(() => {
      if (!this.targets.has(el)) return
      this.cb([{
        target: el,
        contentRect: { width: currentWidth, height: 800 },
        contentBoxSize: [{ inlineSize: currentWidth, blockSize: 800 }],
        borderBoxSize: [{ inlineSize: currentWidth, blockSize: 800 }],
      } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }, 0)
  }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear() }
}

// The locations block: the same shape as crouton-bookings' useBookingsList locations fetch
// (client-only, keyed, empty default).
const TestLocations = defineComponent({
  setup() {
    const { data, status } = useFetch<{ id: string }[]>('/api/test-bookings/locations', {
      key: 'test-bookings-locations',
      server: false,
      default: () => [],
    })
    return () => h('div', { 'data-test': 'locations', 'data-status': status.value },
      data.value.length ? `${data.value.length} locations` : 'No locations yet')
  },
})

const leaf = (name: string) => defineComponent({ name, render: () => h('div', name) })
const USplitter = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('div', { 'data-test': 'splitter' },
      (props.items as unknown[]).map((_, index) => h('div', { 'data-panel': '' }, slots.pane?.({ index, collapsed: false, collapse: () => {}, expand: () => {} }))))
  },
})

const mounted: Array<{ unmount: () => void }> = []

async function waitFor(check: () => boolean, ms: number) {
  const end = Date.now() + ms
  while (Date.now() < end && !check()) {
    await new Promise(r => setTimeout(r, 10))
    await nextTick()
  }
}

describe('booking-demo blocks page at phone width: the bookings fetch lands (#3753)', () => {
  beforeEach(() => {
    hits = 0
    currentWidth = 361
    vi.stubGlobal('ResizeObserver', FakeRO)
    vi.stubGlobal('useCroutonLayoutBlocks', () => ({
      blocks: ref(registry),
      resolveComponentName: (id: string) => registry[id]?.component ?? null,
      sanitizeConfig: () => ({}),
    }))
  })
  afterEach(() => {
    mounted.splice(0).forEach(w => w.unmount())
    clearNuxtData('test-bookings-locations')
    vi.unstubAllGlobals()
  })

  it('shows the locations at 361 px: one request, it completes, status success', async () => {
    const wrapper = await mountSuspended(LayoutRenderer, {
      props: { node: tree, interactive: true },
      global: {
        components: {
          CroutonLayoutRenderer: LayoutRenderer,
          CroutonLayoutCollapseHandle: defineComponent({ render: () => null }),
          USplitter,
          TestCalendar: leaf('TestCalendar'),
          TestFilters: leaf('TestFilters'),
          TestLocations,
          TestList: leaf('TestList'),
        },
      },
    })
    mounted.push(wrapper)
    const locations = () => wrapper.find('[data-test=locations]')
    await waitFor(() => locations().exists() && locations().text() === '3 locations', 1500)

    // Today's main: the pane remounts every few ms, each mount's request is cancelled by the
    // next swap, so this stays "No locations yet" / pending and `hits` climbs.
    expect(locations().text()).toBe('3 locations')
    expect(locations().attributes('data-status')).toBe('success')
    expect(useNuxtApp()._asyncData['test-bookings-locations']?.status.value).toBe('success')
    // The settle swap may start one request that is cancelled before the stacked pane's lands.
    expect(hits).toBeLessThanOrEqual(2)
  })
})
