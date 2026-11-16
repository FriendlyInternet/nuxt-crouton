/**
 * #3046 — slot dots/bars show three shades: empty faint, partly booked ≈ 0.5, full 1.0.
 * A half-full slot (e.g. 1 of 2 booked) used to draw at the same faint opacity as an
 * empty one, so it looked empty. This compiles and server-renders the real
 * Slot/Indicator.vue (no Nuxt runtime needed: it only uses one auto-import, stubbed).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, compileScript } from 'vue/compiler-sfc'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ts from 'typescript'

const file = resolve(__dirname, '../app/components/Slot/Indicator.vue')
let Indicator: Component

beforeAll(async () => {
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: 'slot-indicator', inlineTemplate: true })
  const js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const out = join(mkdtempSync(join(tmpdir(), 'slot-indicator-')), 'Indicator.mjs')
  writeFileSync(out, js)
  ;(globalThis as any).useBookingSlots = () => ({ parseSlotIds: (s: unknown) => (Array.isArray(s) ? s : []) })
  Indicator = (await import(pathToFileURL(out).href)).default
})

async function opacities(variant: 'dots' | 'bars'): Promise<number[]> {
  const html = await renderToString(createSSRApp({
    render: () => h(Indicator, {
      variant,
      slots: [{ id: 'empty' }, { id: 'half' }, { id: 'full' }],
      partialSlotIds: ['half'],
      bookedSlotIds: ['full']
    })
  }))
  return [...html.matchAll(/opacity:\s*([\d.]+)/g)].map(m => Number(m[1]))
}

describe('Slot indicator shades', () => {
  for (const variant of ['dots', 'bars'] as const) {
    it(`${variant}: empty is faint, partly booked is half, full is solid`, async () => {
      const [empty, half, full] = await opacities(variant)
      expect(empty).toBeLessThan(0.2)
      expect(half).toBe(0.5)
      expect(full).toBe(1)
    })
  }
})
