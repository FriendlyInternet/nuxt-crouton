// @vitest-environment happy-dom
/**
 * #4516 — picking one location in the tab row shrinks the calendar: the month
 * cells only make room for that location's indicator line, and the calendar
 * strip is told (via `hold-key`) to measure its held height again, so no empty
 * space stays behind for the hidden locations.
 *
 * Compiles and mounts the real Calendar.vue (same way as
 * calendar-fold-handle.test.ts). CroutonCalendarMonth/Week are stubbed to draw
 * one day through the real #day slot and to show the `holdKey` they get; the
 * strip's own re-measure on a holdKey change is tested against the real
 * Month.vue/Week.vue in crouton-calendar/test/hold-height.test.ts.
 * Auto-imports (useT, useI18n, useBookingSlots, Vue APIs) are stubbed globals.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import * as vue from 'vue'
import { defineComponent, h, ref, type Component } from 'vue'
import { mount } from '@vue/test-utils'
import ts from 'typescript'
import { parseLocationSlots, parseSlotIds } from '../app/composables/useBookingSlots'

const appDir = resolve(__dirname, '../app')
const file = join(appDir, 'components/Calendar.vue')
let Calendar: Component

const DAY = new Date(2026, 10, 18)

// Month/Week stand-ins: one day cell through the real #day slot, holdKey shown as data-hold-key
const CalendarStub = (name: string) => defineComponent({
  name,
  inheritAttrs: false,
  props: { holdKey: { type: [String, Number], default: undefined } },
  setup(props, { slots }) {
    return () => h('div', { 'data-view': name, 'data-hold-key': String(props.holdKey) }, [
      slots.day?.({ day: { day: DAY.getDate() }, jsDate: DAY, neighbour: false }),
    ])
  },
})

const Indicator = defineComponent({
  setup() {
    return () => h('i', { 'data-indicator': '' })
  },
})

const locations = [
  { id: 'a', title: 'A', color: '#f00', slots: [{ id: 's1', label: 'AM' }, { id: 's2', label: 'PM' }] },
  { id: 'b', title: 'B', color: '#0f0', slots: [{ id: 's1', label: 'AM' }] },
  { id: 'c', title: 'C', color: '#00f', slots: [] },
]

beforeAll(async () => {
  const source = readFileSync(file, 'utf8')
  const { descriptor } = parse(source, { filename: file })
  const script = compileScript(descriptor, { id: 'calendar-filtered', inlineTemplate: true })
  let js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  // relative imports point at the real app files
  js = js.replace(/from '\.\.\/([^']+)'/g, (_, p) => `from '${join(appDir, p)}'`)
  // A gitignored dir (.cache) outside node_modules, so vite still transforms the
  // real .ts utils it imports (from node_modules they'd load untransformed).
  const dir = resolve(__dirname, '.cache/calendar-filtered-height')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'Calendar.mjs')
  writeFileSync(out, js)
  const g = globalThis as any
  for (const k of ['ref', 'computed', 'watch', 'shallowReactive', 'onBeforeUnmount', 'onMounted', 'nextTick']) g[k] = (vue as any)[k]
  g.useT = () => ({ t: (k: string) => k })
  g.useI18n = () => ({ locale: ref('en') })
  g.useBookingSlots = () => ({ parseSlotIds, parseLocationSlots })
  g.useEventListener = () => {}
  Calendar = (await import(/* @vite-ignore */ out)).default
})

function mountCalendar(view: 'month' | 'week', picked: string[]) {
  return mount(Calendar, {
    props: {
      bookings: [],
      locations,
      settings: null,
      view,
      date: DAY,
      filters: { statuses: [], locations: picked, showCancelled: false },
    },
    global: {
      components: {
        CroutonCalendarMonth: CalendarStub('month'),
        CroutonCalendarWeek: CalendarStub('week'),
        CroutonBookingsSlotIndicator: Indicator,
      },
      stubs: { UPopover: true, UIcon: true, UButton: true },
    },
  })
}

// The month day cell (the non-neighbour one carries `group relative`)
const monthCell = (w: ReturnType<typeof mountCalendar>) => w.find('.group.relative').element as HTMLElement

describe('Calendar — one location picked shrinks the cells (#4516)', () => {
  it('with 3 locations and one picked, the month cell height is the one-row height', () => {
    const one = mountCalendar('month', ['b'])
    // one indicator row: max(32, 24 + 6·1) = 32px
    expect(monthCell(one).style.minHeight).toBe('32px')
    expect(one.findAll('[data-indicator]')).toHaveLength(1)
    one.unmount()

    // contrast: all three shown = three rows, max(32, 24 + 6·3) = 42px
    const all = mountCalendar('month', [])
    expect(monthCell(all).style.minHeight).toBe('42px')
    expect(all.findAll('[data-indicator]')).toHaveLength(3)
    all.unmount()
  })

  it('tells the month strip to measure again when the picked locations change', async () => {
    const w = mountCalendar('month', [])
    expect(w.find('[data-view="month"]').attributes('data-hold-key')).toBe('3')
    await w.setProps({ filters: { statuses: [], locations: ['b'], showCancelled: false } })
    expect(w.find('[data-view="month"]').attributes('data-hold-key')).toBe('1')
    expect(monthCell(w).style.minHeight).toBe('32px')
    w.unmount()
  })

  // Found in the browser (owner, 25 Nov): with `transition-all` the cell's min-height
  // shrank over 200ms, so the strip re-measured mid-shrink and kept the 3-location height.
  it('the month cell does not animate its height (transition, not transition-all)', () => {
    const w = mountCalendar('month', ['b'])
    const cls = monthCell(w).className.split(/\s+/)
    expect(cls).toContain('transition')
    expect(cls).not.toContain('transition-all')
    w.unmount()
  })

  it('does the same for the week strip', async () => {
    const w = mountCalendar('week', [])
    expect(w.find('[data-view="week"]').attributes('data-hold-key')).toBe('3')
    expect(w.findAll('[data-indicator]')).toHaveLength(3)
    await w.setProps({ filters: { statuses: [], locations: ['b'], showCancelled: false } })
    expect(w.find('[data-view="week"]').attributes('data-hold-key')).toBe('1')
    expect(w.findAll('[data-indicator]')).toHaveLength(1)
    w.unmount()
  })
})

// Owner, 25 Nov (iPhone): one tap on a month day must always select it. The "+" strip at the
// bottom of a month day only shows on devices that can hover; on touch it is display:none,
// so it can't catch a tap on the lower half of the day and open the form.
describe('Calendar — the month "+" strip is only there on hover devices (#4516)', () => {
  it('the strip is display:none unless the device can hover, using real Tailwind', async () => {
    const w = mountCalendar('month', [])
    const strip = w.find('.group.relative button')
    expect(strip.exists()).toBe(true)
    const cls = strip.classes()
    expect(cls).not.toContain('flex') // no unconditional display

    // Compile the strip's own classes with Tailwind and check what a touch screen gets
    const { compile } = await import('tailwindcss')
    const css = (await compile('@tailwind utilities;')).build(cls)
    // the only rule that shows it sits inside a hover media query…
    expect(css).toMatch(/@media \(hover:\s*hover\)\s*\{[^}]*display:\s*flex/)
    // …and outside that query it is display:none
    const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
    expect(outsideMedia).toMatch(/\.hidden\s*\{\s*display:\s*none/)
    expect(outsideMedia).not.toMatch(/display:\s*flex/)
    w.unmount()
  })
})
