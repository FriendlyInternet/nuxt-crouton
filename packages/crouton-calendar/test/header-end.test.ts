// @vitest-environment happy-dom
// #4516: the label row of Month.vue / Week.vue takes a `#header-end` slot at its
// right end (the bookings panel puts its full-screen close there), and tapping
// the label emits `today` after showing today. Runs the real components; only
// Nuxt UI and the Nuxt auto-imports are stubbed (same stubs as panels.test.ts).
import { describe, it, expect, beforeAll } from 'vitest'
import { computed, defineComponent, h, ref } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { useHoldHeight } from '../app/composables/useHoldHeight'

const UCalendar = defineComponent({
  props: { placeholder: { type: Object, required: true }, modelValue: { type: Object, default: undefined } },
  setup(props, { slots }) {
    return () => h('table', [h('tbody', slots.day?.({ day: props.placeholder }))])
  },
})

const UButton = defineComponent({
  setup(_, { slots }) {
    return () => h('button', slots.default?.())
  },
})

const stubs = { UCalendar, UButton, UIcon: true }

let Month: Component
let Week: Component

beforeAll(async () => {
  Object.assign(globalThis, {
    ref,
    computed,
    useHoldHeight,
    useT: () => ({ t: (k: string) => k }),
    useI18n: () => ({ locale: ref('en') }),
    useSlideSwipe: () => ({ slide() {} }),
  })
  Month = (await import('../app/components/Month.vue')).default
  Week = (await import('../app/components/Week.vue')).default
})

const cases = [
  { name: 'Month', comp: () => Month, label: 'button[aria-label="calendar.month.today"]' },
  { name: 'Week', comp: () => Week, label: 'button[title="calendar.week.today"]' },
]

function mountIt(comp: Component, withSlot: boolean) {
  const dates: Date[] = []
  const wrapper = mount(comp, {
    attachTo: document.body,
    props: { 'date': new Date(2020, 0, 15), 'onUpdate:date': (d: Date) => dates.push(d) },
    slots: {
      day: () => h('span'),
      ...(withSlot ? { 'header-end': () => h('button', { 'data-close': '' }, 'X') } : {}),
    },
    global: { stubs },
  })
  return { wrapper, dates }
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

describe('calendar label row: #header-end + today (#4516)', () => {
  for (const c of cases) {
    it(`${c.name}: #header-end renders in the label's own row, at its right end`, () => {
      const { wrapper } = mountIt(c.comp(), true)
      const label = wrapper.element.querySelector(c.label)!
      const close = wrapper.element.querySelector('[data-close]')!
      expect(label).toBeTruthy()
      expect(close).toBeTruthy()
      const row = label.parentElement!.parentElement!
      expect(row.className).toContain('grid-cols-[1fr_auto_1fr]')
      expect(row.contains(close)).toBe(true)
      expect(row.lastElementChild!.contains(close)).toBe(true)
      wrapper.unmount()
    })

    it(`${c.name}: without the slot the row still renders the centred label`, () => {
      const { wrapper } = mountIt(c.comp(), false)
      const label = wrapper.element.querySelector(c.label)!
      expect(label).toBeTruthy()
      const row = label.parentElement!.parentElement!
      expect(row.className).toContain('grid-cols-[1fr_auto_1fr]')
      expect(row.children).toHaveLength(3)
      expect(row.lastElementChild!.children).toHaveLength(0)
      wrapper.unmount()
    })

    it(`${c.name}: tapping the label shows today and emits today once`, async () => {
      const { wrapper, dates } = mountIt(c.comp(), false)
      ;(wrapper.element.querySelector(c.label) as HTMLButtonElement).click()
      await wrapper.vm.$nextTick()
      expect(wrapper.emitted('today')).toHaveLength(1)
      expect(dates.length).toBeGreaterThan(0)
      expect(sameDay(dates[dates.length - 1]!, new Date())).toBe(true)
      wrapper.unmount()
    })
  }
})
