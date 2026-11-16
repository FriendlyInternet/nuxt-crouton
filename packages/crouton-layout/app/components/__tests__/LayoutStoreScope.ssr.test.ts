/**
 * Layout store scope on the server (#3650): two server renders share nothing, and
 * the first browser render of two scoped layouts matches the server HTML.
 * Same harness as LayoutRenderer.ssr.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSRApp, defineComponent, h, ref, type Ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { createLayoutStoreRegistry } from '@fyit/crouton-core/app/utils/layout-store-registry'
import { collectLayoutStores } from '@fyit/crouton-core/app/utils/layout-stores'
import LayoutRenderer from '../LayoutRenderer.vue'
import LayoutStoreScope from '../LayoutStoreScope.vue'

interface TestStore { count: Ref<number>, bump: () => void }

const blocks: CroutonLayoutBlockRegistry = {
  counter: { id: 'counter', name: 'Counter', description: '', icon: '', component: 'TestCounter' },
}
const leaf = (source: string): LayoutNode => ({ type: 'leaf', blockId: 'counter', source })
const left: LayoutTree = { renderer: 'panes', root: { type: 'split', direction: 'horizontal', children: [leaf('test'), leaf('test'), leaf('test#2')] } }
const right: LayoutTree = { renderer: 'panes', root: { type: 'split', direction: 'horizontal', children: [leaf('test'), leaf('test')] } }

/** Bump every copy during setup when set — stands in for a click in "the first request". */
let bumpOnSetup = false

beforeEach(() => {
  bumpOnSetup = false
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(blocks),
    resolveComponentName: (id: string) => blocks[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
})
afterEach(() => vi.unstubAllGlobals())

function app() {
  // A fresh registry per app, as a fresh Nuxt app per request gets.
  const registry = createLayoutStoreRegistry()
  registry.register({
    id: 'test',
    setup() {
      const count = ref(0)
      const s: TestStore = { count, bump: () => { count.value++ } }
      if (bumpOnSetup) s.bump()
      return s
    },
    feeds: { counter: { props: (s: TestStore) => ({ count: s.count.value }), events: { bump: (s: TestStore) => s.bump() } } },
  })
  vi.stubGlobal('useCroutonLayoutStoreRegistry', () => ({ get: registry.get, list: registry.list }))
  const scoped = (t: LayoutTree) => h(LayoutStoreScope, { stores: collectLayoutStores(t) }, () => [h(LayoutRenderer, { node: t.root, interactive: false })])
  const a = createSSRApp(defineComponent({ render: () => h('div', [scoped(left), scoped(right)]) }))
  a.component('CroutonLayoutRenderer', LayoutRenderer)
  a.component('CroutonLayoutCollapseHandle', defineComponent({ render: () => null }))
  a.component('TestCounter', defineComponent({
    props: { count: { type: Number, default: -1 } },
    emits: ['bump'],
    setup: (p, { emit }) => () => h('button', { class: 'counter', onClick: () => emit('bump') }, String(p.count)),
  }))
  return a
}

const counts = (html: string) => [...html.matchAll(/<button class="counter[^"]*"[^>]*>(-?\d+)<\/button>/g)].map(m => m[1])

describe('layout store scope — server renders (#3650)', () => {
  it('(a) two renders of the same app share no store instance or state', async () => {
    bumpOnSetup = true
    const first = await renderToString(app())
    expect(counts(first)).toEqual(['1', '1', '1', '1', '1'])
    bumpOnSetup = false
    const second = await renderToString(app())
    expect(counts(second)).toEqual(['0', '0', '0', '0', '0'])
  })

  it('(b) two scoped layouts hydrate without a mismatch', async () => {
    const html = await renderToString(app())
    const el = document.createElement('div')
    el.innerHTML = html
    document.body.appendChild(el)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = app()
    const warnings: string[] = []
    client.config.warnHandler = (msg) => { warnings.push(msg) }
    client.mount(el)
    const all = [...warnings, ...warn.mock.calls.flat(), ...error.mock.calls.flat()].map(String)
    expect(all.filter(m => /hydrat|mismatch/i.test(m))).toEqual([])
    expect(el.querySelectorAll('.counter')).toHaveLength(5)
    client.unmount(); el.remove(); warn.mockRestore(); error.mockRestore()
  })
})
