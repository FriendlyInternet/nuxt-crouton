/**
 * Layout store scope (#3650) — every pane of one layout reads the same store copy;
 * two layouts never share one; `test` and `test#2` are separate copies.
 *
 * The test store stands in for `useFetch` with a plain `ref` and counts how many
 * times its `setup` ran; `ctx.key` is captured per copy. The registry is a real
 * `createLayoutStoreRegistry()`, reached through a stubbed
 * `useCroutonLayoutStoreRegistry` (the Nuxt auto-import).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, inject, nextTick, ref, type Ref } from 'vue'
import type { LayoutNode, LayoutTree, LayoutStoreContext } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { createLayoutStoreRegistry } from '@fyit/crouton-core/app/utils/layout-store-registry'
import { collectLayoutStores } from '@fyit/crouton-core/app/utils/layout-stores'
import LayoutRenderer from '../LayoutRenderer.vue'
import LayoutStoreScope from '../LayoutStoreScope.vue'
import Layout from '../Layout.vue'
import { LAYOUT_EDIT_KEY, type LayoutEditApi } from '../../composables/useCroutonLayoutEdit'

interface TestStore { source: string, key: string, count: Ref<number>, bump: () => void }

const blocks: CroutonLayoutBlockRegistry = {
  counter: { id: 'counter', name: 'Counter', description: '', icon: '', component: 'TestCounter' },
}

let setups: LayoutStoreContext[] = []
let stores: TestStore[] = []

const Counter = defineComponent({
  props: { count: { type: Number, default: -1 }, label: { type: String, default: 'none' } },
  emits: ['bump'],
  setup(p, { emit }) {
    return () => h('button', { 'class': 'counter', 'data-label': p.label, 'onClick': () => emit('bump') }, `${p.label}: ${p.count}`)
  },
})

beforeEach(() => {
  setups = []
  stores = []
  const registry = createLayoutStoreRegistry()
  registry.register({
    id: 'test',
    setup(ctx) {
      setups.push(ctx)
      const count = ref(Number(ctx.options.start ?? 0))
      const s: TestStore = { source: ctx.source, key: ctx.key, count, bump: () => { count.value++ } }
      stores.push(s)
      return s
    },
    feeds: {
      counter: {
        props: (s: TestStore) => ({ count: s.count.value, label: s.source }),
        events: { bump: (s: TestStore) => s.bump() },
      },
    },
  })
  vi.stubGlobal('useCroutonLayoutStoreRegistry', () => ({ get: registry.get, list: registry.list }))
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(blocks),
    blocksList: ref(Object.values(blocks)),
    getBlock: (id: string) => blocks[id],
    checkViability: () => ({ viable: true, violations: [] }),
    resolveComponentName: (id: string) => blocks[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const global = {
  components: {
    CroutonLayoutRenderer: LayoutRenderer,
    CroutonLayoutStoreScope: LayoutStoreScope,
    CroutonLayoutCollapseHandle: defineComponent({ render: () => null }),
    TestCounter: Counter,
  },
}

const leaf = (source?: string): LayoutNode => ({ type: 'leaf', blockId: 'counter', ...(source ? { source } : {}) })
const split = (...children: LayoutNode[]): LayoutNode => ({ type: 'split', direction: 'horizontal', children })
const tree = (root: LayoutNode): LayoutTree => ({ renderer: 'panes', root })

/** One scope from the full tree, rendering its root (and optional sibling renderers). */
function scoped(t: LayoutTree, siblings: LayoutNode[] = []) {
  return h(LayoutStoreScope, { stores: collectLayoutStores(t) }, () => [
    h(LayoutRenderer, { node: t.root, interactive: false }),
    ...siblings.map(n => h(LayoutRenderer, { node: n, interactive: false })),
  ])
}

describe('CroutonLayoutStoreScope', () => {
  it('(a) two scopes with `test` get different store instances and different keys', async () => {
    const t = tree(leaf('test'))
    const w = mount(defineComponent({ render: () => h('div', [scoped(t), scoped(t)]) }), { global })
    expect(setups).toHaveLength(2)
    expect(stores[0]).not.toBe(stores[1])
    expect(setups[0]!.key).not.toBe(setups[1]!.key)
    expect(setups[0]!.key).toMatch(/^layout-store:.+:test$/)
    await w.findAll('.counter')[0]!.trigger('click')
    expect(w.findAll('.counter').map(b => b.text())).toEqual(['test: 1', 'test: 0'])
  })

  it('(b) a split + a nested sub-layout under one scope all share one instance', async () => {
    const t = tree(split(leaf('test'), leaf('test'), { type: 'nested', layout: tree(split(leaf('test'), leaf('test'))) }))
    const w = mount(defineComponent({ render: () => scoped(t) }), { global })
    expect(setups).toHaveLength(1)
    expect(w.findAll('.counter')).toHaveLength(4)
    await w.findAll('.counter')[3]!.trigger('click')
    expect(w.findAll('.counter').map(b => b.text())).toEqual(['test: 1', 'test: 1', 'test: 1', 'test: 1'])
  })

  it('(c) a hidden-leaf renderer mounted as a sibling inside the same scope reads the same copy', async () => {
    const t = tree(leaf('test'))
    const w = mount(defineComponent({ render: () => scoped(t, [leaf('test')]) }), { global })
    expect(setups).toHaveLength(1)
    await w.findAll('.counter')[1]!.trigger('click')
    expect(w.findAll('.counter').map(b => b.text())).toEqual(['test: 1', 'test: 1'])
  })

  it('(d) `test` and `test#2` are different instances with different keys', async () => {
    const t = tree(split(leaf('test'), leaf('test#2')))
    const w = mount(defineComponent({ render: () => scoped(t) }), { global })
    expect(setups.map(s => s.source)).toEqual(['test', 'test#2'])
    expect(stores[0]).not.toBe(stores[1])
    expect(setups[0]!.key).not.toBe(setups[1]!.key)
    await w.findAll('.counter')[0]!.trigger('click')
    expect(w.findAll('.counter').map(b => b.text())).toEqual(['test: 1', 'test#2: 0'])
  })

  it('(e) re-keying the inner renderer (a breakpoint change) keeps the same copy', async () => {
    const t = tree(leaf('test'))
    const bp = ref('base')
    const w = mount(defineComponent({
      render: () => h(LayoutStoreScope, { stores: collectLayoutStores(t) }, () => [
        h(LayoutRenderer, { node: t.root, interactive: false, key: bp.value }),
      ]),
    }), { global })
    await w.find('.counter').trigger('click')
    bp.value = 'desktop'
    await nextTick()
    expect(setups).toHaveLength(1)
    expect(w.find('.counter').text()).toBe('test: 1')
  })

  it('(f) a leaf whose source is not in the scope gets no store props and warns naming the source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = mount(defineComponent({
      render: () => h(LayoutStoreScope, { stores: [] }, () => [h(LayoutRenderer, { node: leaf('ghost'), interactive: false })]),
    }), { global })
    expect(w.find('.counter').text()).toBe('none: -1')
    expect(warn.mock.calls.flat().map(String).some(m => m.includes('"ghost"'))).toBe(true)
    expect(setups).toHaveLength(0)
  })

  it('(g) a renderer with no surrounding scope creates its own', async () => {
    const w = mount(LayoutRenderer, { props: { node: split(leaf('test'), leaf('test')), interactive: false }, global })
    expect(setups).toHaveLength(1)
    await w.findAll('.counter')[0]!.trigger('click')
    expect(w.findAll('.counter').map(b => b.text())).toEqual(['test: 1', 'test: 1'])
  })

  it('(h) an edit in CroutonLayout emits a tree that still carries `sources`', () => {
    let api: LayoutEditApi | undefined
    const EditorPane = defineComponent({ setup() { api = inject(LAYOUT_EDIT_KEY); return () => h('div') } })
    const model: LayoutTree = { renderer: 'panes', root: split(leaf('test'), leaf('test')), sources: { test: { options: { start: 3 } } } }
    const w = mount(Layout, {
      props: { modelValue: model },
      global: {
        stubs: { CroutonLayoutEditorPane: EditorPane, UBadge: true, UButton: true, UIcon: true, UFormField: true, USwitch: true, UInputNumber: true, USelect: true, UInput: true },
      },
    })
    api!.resize([], [30, 70])
    const emitted = w.emitted('update:modelValue')!.at(-1)![0] as LayoutTree
    expect(emitted.sources).toEqual({ test: { options: { start: 3 } } })
    expect((emitted.root as { children: LayoutNode[] }).children[0]!.defaultSize).toBe(30)
  })
})
