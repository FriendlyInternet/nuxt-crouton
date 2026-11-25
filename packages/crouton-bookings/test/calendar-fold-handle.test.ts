// @vitest-environment happy-dom
/**
 * #4516 — the icon-only toggle at the left of the panel calendar's label row folds month ↔ week.
 * Compiles and mounts the real CalendarFoldHandle.vue (same way as
 * slot-indicator-touch.test.ts). The `useT` auto-import is stubbed to return the key.
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

// A plain <button> that passes attrs (aria-*, class) and the click through,
// and exposes the `icon` prop as data-icon so the icon can be checked
const UButton = defineComponent({
  inheritAttrs: false,
  props: { icon: { type: String, default: undefined } },
  setup(props, { attrs, slots }) {
    return () => h('button', { 'type': 'button', 'data-icon': props.icon, ...attrs }, slots.default?.())
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

  it('shows calendar-days in week and calendar-minus-2 in month', async () => {
    const { w } = mountHandle('week')
    expect(w.find('button').attributes('data-icon')).toBe('i-lucide-calendar-days')
    await click(w)
    expect(w.find('button').attributes('data-icon')).toBe('i-lucide-calendar-minus-2')
  })

  it('is icon-only: no text, ghost/neutral, same size as the close X (sm)', () => {
    const { w } = mountHandle('week')
    expect(w.find('button').text()).toBe('')
    expect(source).toMatch(/variant="ghost"/)
    expect(source).toMatch(/color="neutral"/)
    expect(source).toMatch(/size="sm"/)
  })

  it('has no drag code and no touch-action: none any more', () => {
    expect(source).not.toMatch(/usePointerSwipe|touch-none/)
  })
})
