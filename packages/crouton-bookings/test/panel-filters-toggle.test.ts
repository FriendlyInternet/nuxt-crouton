// @vitest-environment happy-dom
/**
 * #4562 — on composed pages (viewToggles=false) PanelFilters shows the Show cancelled
 * text toggle (the real ListToggles.vue, the one the Panel's list uses) instead of the cog.
 *
 * Compiles and mounts the real PanelFilters.vue and the real ListToggles.vue (same way as
 * calendar-filtered-height.test.ts). UButton is a plain <button> that passes attrs and the
 * default slot through; LocationTabs and UIcon are stubbed. Auto-imports (useT, Vue APIs)
 * are stubbed globals.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as vue from 'vue'
import { defineComponent, h, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import ts from 'typescript'

const appDir = resolve(__dirname, '../app')
const dir = resolve(__dirname, '.cache/panel-filters-toggle')

async function compile(name: string): Promise<Component> {
  const file = join(appDir, 'components', `${name}.vue`)
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: `panel-filters-${name}`, inlineTemplate: true })
  let js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  js = js.replace(/from '\.\.\/([^']+)'/g, (_, p) => `from '${join(appDir, p)}'`)
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${name}.mjs`)
  writeFileSync(out, js)
  return (await import(/* @vite-ignore */ out)).default
}

const UButton = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', { ...attrs }, slots.default?.())
  },
})

let PanelFilters: Component
let ListToggles: Component

beforeAll(async () => {
  const g = globalThis as any
  for (const k of ['ref', 'computed', 'watch']) g[k] = (vue as any)[k]
  g.useT = () => ({ t: (k: string) => k })
  ListToggles = await compile('ListToggles')
  PanelFilters = await compile('PanelFilters')
})

function mountFilters(viewToggles: boolean) {
  return mount(PanelFilters, {
    props: {
      locations: [{ id: 'a', title: 'A' }],
      selectedLocations: [],
      showCancelled: false,
      viewToggles,
    },
    global: {
      components: { CroutonBookingsListToggles: ListToggles, UButton },
      stubs: { CroutonBookingsLocationTabs: true, UIcon: true },
    },
  })
}

const cancelledButton = (w: ReturnType<typeof mountFilters>) =>
  w.findAll('button').find(b => b.text() === 'bookings.filters.cancelled')

describe('PanelFilters — Show cancelled text toggle on composed pages (#4562)', () => {
  // covers: T2
  it('with viewToggles=false, clicking Show cancelled emits update:showCancelled true', async () => {
    const w = mountFilters(false)
    const btn = cancelledButton(w)
    expect(btn).toBeDefined()
    // no Map button: canShowMap is false
    expect(w.findAll('button').some(b => b.text() === 'bookings.filters.map')).toBe(false)
    await btn!.trigger('click')
    expect(w.emitted('update:showCancelled')).toEqual([[true]])
    w.unmount()
  })

  // covers: T2
  it('with viewToggles=true (the Panel), no Show cancelled button renders', () => {
    const w = mountFilters(true)
    expect(cancelledButton(w)).toBeUndefined()
    w.unmount()
  })
})
