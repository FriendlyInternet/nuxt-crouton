// @vitest-environment happy-dom
/**
 * #4516 — the drag handle under the panel calendar folds month ↔ week.
 * Compiles and mounts the real CalendarFoldHandle.vue (same way as
 * slot-indicator-touch.test.ts). The auto-imports are stubbed: `usePointerSwipe`
 * captures its options so the test can fire a swipe end, `useT` returns the key.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import { defineComponent, h, ref, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import ts from 'typescript'

const file = resolve(__dirname, '../app/components/CalendarFoldHandle.vue')
const source = readFileSync(file, 'utf8')
let Handle: Component
let swipe: { target: unknown, options: any } | null = null

// A plain <button> that passes attrs (aria-*, class) and the click through
const UButton = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('button', { type: 'button', ...attrs }, slots.default?.())
  },
})

beforeAll(async () => {
  const { descriptor } = parse(source, { filename: file })
  const script = compileScript(descriptor, { id: 'calendar-fold-handle', inlineTemplate: true })
  const js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  // Under happy-dom an import from os.tmpdir() can't resolve; a gitignored dir in the package can.
  const dir = resolve(__dirname, '../node_modules/.cache/calendar-fold-handle')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'CalendarFoldHandle.mjs')
  writeFileSync(out, js)
  const g = globalThis as any
  g.ref = ref
  g.useT = () => ({ t: (k: string) => k })
  g.usePointerSwipe = (target: unknown, options: any) => {
    swipe = { target, options }
    return {}
  }
  Handle = (await import(/* @vite-ignore */ out)).default
})

function mountHandle(initial: 'week' | 'month') {
  const state = { value: initial }
  const w = mount(Handle, {
    props: {
      'modelValue': initial,
      'onUpdate:modelValue': (v: 'week' | 'month') => {
        state.value = v
        w.setProps({ modelValue: v })
      },
    },
    global: { components: { UButton } },
  })
  return { w, state }
}

const click = async (w: any, detail = 1) => {
  w.find('button').element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
  await w.vm.$nextTick()
}

describe('CalendarFoldHandle (#4516)', () => {
  it('a tap toggles month → week → month', async () => {
    const { w, state } = mountHandle('month')
    await click(w)
    expect(state.value).toBe('week')
    await click(w)
    expect(state.value).toBe('month')
  })

  it('a keyboard click (Enter/Space, detail 0) toggles', async () => {
    const { w, state } = mountHandle('week')
    await click(w, 0)
    expect(state.value).toBe('month')
  })

  it('aria-expanded is "true" only in month; the button has a translated label', async () => {
    const { w } = mountHandle('month')
    expect(w.find('button').attributes('aria-expanded')).toBe('true')
    expect(w.find('button').attributes('aria-label')).toBe('bookings.panel.calendarHandle')
    await click(w)
    expect(w.find('button').attributes('aria-expanded')).toBe('false')
  })

  it('swipe up folds to week, swipe down unfolds to month', async () => {
    const { w, state } = mountHandle('month')
    expect(swipe).not.toBeNull()
    swipe!.options.onSwipeStart?.(new Event('pointerdown'))
    swipe!.options.onSwipeEnd(new Event('pointerup'), 'up')
    await w.vm.$nextTick()
    expect(state.value).toBe('week')
    swipe!.options.onSwipeStart?.(new Event('pointerdown'))
    swipe!.options.onSwipeEnd(new Event('pointerup'), 'down')
    await w.vm.$nextTick()
    expect(state.value).toBe('month')
  })

  it('the click right after a drag does not undo it; the next tap toggles again', async () => {
    const { w, state } = mountHandle('month')
    swipe!.options.onSwipeStart?.(new Event('pointerdown'))
    swipe!.options.onSwipeEnd(new Event('pointerup'), 'up')
    await w.vm.$nextTick()
    await click(w)
    expect(state.value).toBe('week')
    await click(w)
    expect(state.value).toBe('month')
  })

  it('the swipe target is the handle wrapper and it blocks page scroll with touch-none!', () => {
    const { w } = mountHandle('week')
    expect((swipe!.target as any).value).toBe(w.element)
    expect(source).toMatch(/<div ref="handleEl" class="[^"]*\btouch-none!/)
  })
})
