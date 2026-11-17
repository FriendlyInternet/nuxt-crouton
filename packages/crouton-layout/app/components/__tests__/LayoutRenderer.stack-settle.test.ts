/**
 * A too-narrow interactive split must SETTLE stacked, not swap forever (#3753, #3771).
 *
 * Before: `useElementSize(groupRef)` measured the split, and `groupRef` moved between the
 * stacked `<div>`, the hug `<div>` and the USplitter. VueUse resets the width to 0 whenever
 * its target element changes, so on a phone the renderer went splitter (361 px → too narrow)
 * → stacked (target changed → width 0 → "don't stack") → splitter → … without end. Every
 * swap rebuilt the panes, so a button was detached before a tap could land.
 *
 * Fix: ONE wrapper `<div>` (`measureRef`) around the three branches is what gets measured,
 * so a branch switch never changes the measured element. `groupRef` stays on the active
 * branch for FLIP only.
 *
 * Harness from PR #3767 (its archaeology found the loop). Tree: booking-demo's real blocks
 * page (`pocs/booking-demo/app/pages/admin/[team]/blocks.vue`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed, createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import type { LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import LayoutRenderer from '../LayoutRenderer.vue'
import { LAYOUT_COLLAPSE_KEY, LAYOUT_CONTAINER_WIDTH_KEY } from '../../composables/useCroutonLayoutResponsive'

// Capture the `panels` option the renderer hands FLIP, so we can check what it resolves.
const flip = vi.hoisted(() => ({ panels: [] as Array<() => HTMLElement[]> }))
vi.mock('../../composables/useLayoutFlip', () => ({
  useLayoutFlip: (opts: { panels: () => HTMLElement[] }) => { flip.panels.push(opts.panels) },
}))

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
let mo: MutationObserver | null = null
let switches = 0
// Every `items` prop the stubbed USplitter rendered with, by orientation.
let splitterItems: Array<{ orientation: string, items: Array<Record<string, unknown>> }> = []

beforeEach(() => {
  currentWidth = 0
  observeCalls = 0
  switches = 0
  splitterItems = []
  flip.panels = []
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
})
afterEach(() => {
  mo?.disconnect()
  mo = null
  app?.unmount()
  app = null
  el.remove()
  vi.unstubAllGlobals()
})

function mount(opts: { injected?: number, collapse?: Set<string> } = {}) {
  app = createApp(defineComponent({ render: () => h(LayoutRenderer, { node: tree, interactive: true }) }))
  if (opts.injected !== undefined) app.provide(LAYOUT_CONTAINER_WIDTH_KEY, ref(opts.injected))
  if (opts.collapse) {
    const collapsedSet = opts.collapse
    app.provide(LAYOUT_COLLAPSE_KEY, computed(() => ({ style: 'spring-drawer' as const, collapsedSet, expand: () => {} })))
  }
  app.component('CroutonLayoutRenderer', LayoutRenderer)
  app.component('CroutonLayoutCollapseHandle', defineComponent({ render: () => null }))
  app.component('USplitter', defineComponent({
    props: { items: { type: Array, default: () => [] }, orientation: { type: String, default: 'horizontal' } },
    setup(props, { slots }) {
      return () => {
        splitterItems.push({ orientation: props.orientation, items: props.items as Array<Record<string, unknown>> })
        return h('div', { 'data-test': 'splitter' },
          (props.items as unknown[]).map((_, index) => h('div', { 'data-panel': '' }, slots.pane?.({ index, collapsed: false, collapse: () => {}, expand: () => {} }))))
      }
    },
  }))
  for (const name of ['TestCalendar', 'TestFilters', 'TestLocations', 'TestList'])
    app.component(name, defineComponent({ render: () => h('div', name) }))
  app.mount(el)
  // Count branch switches on the measured WRAPPER (it never changes itself, so counting at
  // `el` would pass trivially). Each new branch ELEMENT added = one switch; comment anchors ignored.
  mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) switches++ })
  })
  mo.observe(wrapper(), { childList: true })
}

const wrapper = () => el.firstElementChild as HTMLElement
// The active branch element INSIDE the measured wrapper.
const root = () => wrapper()?.firstElementChild as HTMLElement | null
const isStacked = () => {
  const r = root()
  return !!r && r.classList.contains('flex-col') && r.getAttribute('data-test') !== 'splitter'
    && Array.from(r.children).every(c => c.hasAttribute('data-crouton-pane'))
}
const isSplitter = () => root()?.getAttribute('data-test') === 'splitter'
// FLIP for the ROOT split is the first `useLayoutFlip` call (the root sets up before its children).
const rootPanels = () => flip.panels[0]!()

describe('a too-narrow interactive split settles instead of looping (#3753, #3771)', () => {
  it('settles stacked at 361 px', async () => {
    currentWidth = 361
    mount()
    await ticks(20)
    expect(isStacked()).toBe(true)
    const switchesAt20 = switches
    const observesAt20 = observeCalls
    await ticks(10)
    expect(isStacked()).toBe(true)
    expect(switches).toBe(switchesAt20)
    expect(observeCalls).toBe(observesAt20)
  })

  it('stays side by side at 1400 px', async () => {
    currentWidth = 1400
    mount()
    await ticks(30)
    expect(isSplitter()).toBe(true)
    expect(switches).toBe(0)
  })

  it('361 → 1400 un-stacks exactly once', async () => {
    currentWidth = 361
    mount()
    await ticks(30)
    expect(isStacked()).toBe(true)
    const before = switches
    currentWidth = 1400
    for (const ro of live) ro.fire()
    await ticks(5)
    expect(isSplitter()).toBe(true)
    expect(switches - before).toBe(1)
    await ticks(30)
    expect(isSplitter()).toBe(true)
    expect(switches - before).toBe(1)
  })

  it('transform-scaled frame: observer reads 0, injected container width 361 → stacked', async () => {
    currentWidth = 0
    mount({ injected: 361 })
    await ticks(30)
    expect(isStacked()).toBe(true)
  })

  it('FLIP finds the panes of the active branch, not the wrapper', async () => {
    currentWidth = 1400
    mount()
    await ticks(30)
    expect(isSplitter()).toBe(true)
    const wide = rootPanels()
    expect(wide).toHaveLength(2)
    for (const p of wide) {
      expect(p.hasAttribute('data-panel')).toBe(true)
      expect(p.parentElement).toBe(root())
      expect(p.parentElement).not.toBe(wrapper())
    }
    app!.unmount()
    app = null
    mo?.disconnect()
    flip.panels = []
    el.innerHTML = ''

    currentWidth = 361
    mount()
    await ticks(30)
    expect(isStacked()).toBe(true)
    const narrow = rootPanels()
    expect(narrow).toHaveLength(2)
    for (const p of narrow) {
      expect(p.hasAttribute('data-crouton-pane')).toBe(true)
      expect(p.parentElement).toBe(root())
      expect(p.parentElement).not.toBe(wrapper())
    }
  })

  it('in-place collapse reads the wrapper width', async () => {
    currentWidth = 1400
    mount({ collapse: new Set(['bookings-calendar-only']) })
    await ticks(30)
    expect(isSplitter()).toBe(true)
    const last = splitterItems.filter(s => s.orientation === 'horizontal').at(-1)!
    expect(last.items[0]!.collapsedSize).toBeCloseTo((46 / 1400) * 100, 5)
  })
})
