/**
 * A served page's side-by-side group must render the same on the server and in the
 * browser, and stack below its threshold without generated CSS (#2567).
 *
 * Before: the view-mode split emitted a per-split `<style>` container query. The
 * server HTML-escaped it (`[data-cq=&quot;…&quot;]`), so a phone saw the wrong
 * arrangement until hydration, and every load logged a hydration mismatch.
 * Contract: no `<style>` in the output; the threshold travels as an inline CSS
 * variable; proportions as flex-grow; hydration is clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSSRApp, defineComponent, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LayoutSplit } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import LayoutRenderer from '../LayoutRenderer.vue'

const registry: CroutonLayoutBlockRegistry = {
  wide: { id: 'wide', name: 'Wide', description: '', icon: '', component: 'TestWide', minWidth: 460 },
  rail: { id: 'rail', name: 'Rail', description: '', icon: '', component: 'TestRail', minWidth: 300 },
}

const split: LayoutSplit = {
  type: 'split',
  direction: 'horizontal',
  children: [
    { type: 'leaf', blockId: 'wide', defaultSize: 62 },
    { type: 'leaf', blockId: 'rail', defaultSize: 38 },
  ],
}

beforeEach(() => {
  vi.stubGlobal('useCroutonLayoutBlocks', () => ({
    blocks: ref(registry),
    resolveComponentName: (id: string) => registry[id]?.component ?? null,
    sanitizeConfig: () => ({}),
  }))
})
afterEach(() => vi.unstubAllGlobals())

function app() {
  const a = createSSRApp(defineComponent({ render: () => h(LayoutRenderer, { node: split, interactive: false }) }))
  a.component('CroutonLayoutRenderer', LayoutRenderer)
  a.component('CroutonLayoutCollapseHandle', defineComponent({ render: () => null }))
  a.component('TestWide', defineComponent({ render: () => h('div', 'wide') }))
  a.component('TestRail', defineComponent({ render: () => h('div', 'rail') }))
  return a
}

describe('view-mode split renders identically on server and client (#2567)', () => {
  it('emits no generated <style> on the server', async () => {
    const html = await renderToString(app())
    expect(html).not.toContain('<style')
    expect(html).not.toContain('&quot;')
  })

  it('carries the stack threshold as an inline CSS variable (the sum of the floors)', async () => {
    const html = await renderToString(app())
    expect(html).toMatch(/--stack-at:\s*760px/)
  })

  it('keeps the proportions as flex-grow', async () => {
    const html = await renderToString(app())
    expect(html).toMatch(/flex-grow:\s*62/)
    expect(html).toMatch(/flex-grow:\s*38/)
  })

  it('hydrates without a mismatch', async () => {
    const html = await renderToString(app())
    const el = document.createElement('div')
    el.innerHTML = html
    document.body.appendChild(el)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = app()
    const warnings: string[] = []
    client.config.warnHandler = msg => { warnings.push(msg) }
    client.mount(el)
    const all = [...warnings, ...warn.mock.calls.flat(), ...error.mock.calls.flat()].map(String)
    expect(all.filter(m => /hydrat|mismatch/i.test(m))).toEqual([])
    client.unmount(); el.remove(); warn.mockRestore(); error.mockRestore()
  })
})
