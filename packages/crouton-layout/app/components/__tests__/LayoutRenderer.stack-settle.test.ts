/**
 * A too-narrow interactive split must SETTLE stacked, not swap forever (#3753).
 *
 * Before: one `useElementSize(groupRef)` measured the split, and `groupRef` moves
 * between the stacked `<div>`, the hug `<div>` and the USplitter. VueUse resets the
 * width to 0 whenever its target element changes, so on a phone the renderer went
 * splitter (361 px → too narrow) → stacked (target changed → width 0 → "don't
 * stack") → splitter → … ~10×/s. Every swap rebuilt the panes, so a button was
 * detached before a tap could land.
 *
 * Contract: the renderer keeps the last non-zero width as its stacking basis, so the
 * swap happens once and stays; widening still un-stacks; the device-frame fallback
 * (observer always 0, injected container width) still stacks.
 *
 * Tree: booking-demo's real blocks page (`pocs/booking-demo/app/pages/admin/[team]/blocks.vue`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import type { LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import LayoutRenderer from '../LayoutRenderer.vue'
import { LAYOUT_CONTAINER_WIDTH_KEY } from '../../composables/useCroutonLayoutResponsive'

const registry: CroutonLayoutBlockRegistry = {
  'bookings-calendar-only': { id: 'bookings-calendar-only', name: 'Calendar', description: '', icon: '', component: 'TestCalendar', minWidth: 460 },
  'bookings-filters': { id: 'bookings-filters', name: 'Filters', description: '', icon: '', component: 'TestFilters', minWidth: 240 },
  'bookings-locations': { id: 'bookings-locations', name: 'Locations', description: '', icon: '', component: 'TestLocations', minWidth: 220 },
  'bookings-list': { id: 'bookings-list', name: 'List', description: '', icon: '', component: 'TestList', minWidth: 300 },
}

// booking-demo's blocks tree (same ids, sizes and nesting as blocks.vue).
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

// A controllable ResizeObserver: `observe(el)` reports `currentWidth` on the next macrotask
// (as a real observer does on attach); `fire()` re-reports to every live observation.
let currentWidth = 0
let observeCalls = 0
const live = new Set<FakeRO>()
class FakeRO {
  targets = new Set<Element>()
  constructor(private cb: ResizeObserverCallback) { live.add(this) }
  observe(el: Element) {
    observeCalls++
    this.targets.add(el)
    setTimeout(() => { if (this.targets.has(el)) this.report(el) }, 0)
  }
  unobserve(el: Element) { this.targets.delete(el) }
  disconnect() { this.targets.clear(); live.delete(this) }
  report(el: Element) {
    const entry = {
      target: el,
      contentRect: { width: currentWidth, height: 800 },
      contentBoxSize: [{ inlineSize: currentWidth, blockSize: 800 }],
      borderBoxSize: [{ inlineSize: currentWidth, blockSize: 800 }],
    } as unknown as ResizeObserverEntry
    this.cb([entry], this as unknown as ResizeObserver)
  }
  fire() { for (const el of this.targets) this.report(el) }
}

async function ticks(n: number) {
  for (let i = 0; i < n; i++) {
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
  }
}

let app: App | null = null
let el: HTMLElement
let mo: MutationObserver
let rootSwaps = 0

beforeEach(() => {
  currentWidth = 0
  observeCalls = 0
  rootSwaps = 0
  live.clear()
  vi.stubGlobal('ResizeObserver', FakeRO)
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(registry),
    resolveComponentName: (id: string) => registry[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
  el = document.createElement('div')
  document.body.appendChild(el)
  // Count root-branch swaps: each time a new root ELEMENT is mounted (dev-mode template
  // comments and fragment anchors are text/comment nodes — ignored).
  mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) rootSwaps++ })
  })
  mo.observe(el, { childList: true })
})
afterEach(() => {
  mo.disconnect()
  app?.unmount()
  app = null
  el.remove()
  vi.unstubAllGlobals()
})

function mount(opts: { injected?: number } = {}) {
  app = createApp(defineComponent({ render: () => h(LayoutRenderer, { node: tree, interactive: true }) }))
  if (opts.injected !== undefined) app.provide(LAYOUT_CONTAINER_WIDTH_KEY, ref(opts.injected))
  app.component('CroutonLayoutRenderer', LayoutRenderer)
  app.component('CroutonLayoutCollapseHandle', defineComponent({ render: () => null }))
  app.component('USplitter', defineComponent({
    props: { items: { type: Array, default: () => [] } },
    setup(props, { slots }) {
      return () => h('div', { 'data-test': 'splitter' },
        (props.items as unknown[]).map((_, index) => h('div', { 'data-panel': '' }, slots.pane?.({ index, collapsed: false, collapse: () => {}, expand: () => {} }))))
    },
  }))
  for (const name of ['TestCalendar', 'TestFilters', 'TestLocations', 'TestList'])
    app.component(name, defineComponent({ render: () => h('div', name) }))
  app.mount(el)
}

const root = () => el.firstElementChild as HTMLElement
const isStacked = () => {
  const r = root()
  return !!r && r.classList.contains('flex-col') && r.getAttribute('data-test') !== 'splitter'
    && Array.from(r.children).every(c => c.hasAttribute('data-crouton-pane'))
}
const isSplitter = () => root()?.getAttribute('data-test') === 'splitter'

describe('a too-narrow interactive split settles instead of looping (#3753)', () => {
  it('settles stacked at 393 px (361 px content) — swaps once, then the observer goes quiet', async () => {
    currentWidth = 361
    mount()
    await ticks(20)
    const swapsAt20 = rootSwaps
    const observesAt20 = observeCalls
    await ticks(10)
    expect(isStacked()).toBe(true)
    expect(isSplitter()).toBe(false)
    // One swap from the initial splitter to the stack (the initial mount adds 1 node).
    expect(rootSwaps).toBeLessThanOrEqual(2)
    expect(rootSwaps).toBe(swapsAt20)
    expect(observeCalls).toBe(observesAt20)
  })

  it('stays side-by-side when wide (1200 px) and never stacks', async () => {
    currentWidth = 1200
    mount()
    await ticks(30)
    expect(isSplitter()).toBe(true)
    expect(rootSwaps).toBe(1)
  })

  it('un-stacks once on widening and stays (the remembered width does not trap it stacked)', async () => {
    currentWidth = 361
    mount()
    await ticks(30)
    expect(isStacked()).toBe(true)
    currentWidth = 1200
    for (const ro of live) ro.fire()
    await ticks(5)
    expect(isSplitter()).toBe(true)
    const swaps = rootSwaps
    await ticks(30)
    expect(isSplitter()).toBe(true)
    expect(rootSwaps).toBe(swaps)
  })

  it('still stacks in a device frame (observer reads 0, injected container width 361)', async () => {
    currentWidth = 0
    mount({ injected: 361 })
    await ticks(30)
    expect(isStacked()).toBe(true)
  })
})
