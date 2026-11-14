// @vitest-environment happy-dom
// Panel identity (#3917): the three swipe panels are keyed by the month / week
// they show, so a step keeps the two staying panels as the SAME DOM elements
// and builds exactly one new one. Runs the real Month.vue / Week.vue; only
// Nuxt UI (UCalendar, UButton) and the Nuxt auto-imports are stubbed.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { useHoldHeight } from '../app/composables/useHoldHeight'

let built = 0

// Counts every UCalendar table body built (one per table, like Nuxt UI's grid).
const DayHost = defineComponent({
  setup(_, { slots }) {
    built++
    return () => h('tbody', slots.default?.())
  },
})

// Like Nuxt UI, the grid <table> is keyed by the month it shows.
const UCalendar = defineComponent({
  props: { placeholder: { type: Object, required: true }, modelValue: { type: Object, default: undefined } },
  setup(props, { slots }) {
    return () => {
      const p = props.placeholder as { year: number, month: number }
      const key = `${p.year}-${p.month}`
      return h('table', { 'key': key, 'data-month': key }, [
        h(DayHost, { key }, () => slots.day?.({ day: props.placeholder })),
      ])
    }
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
    watch,
    onBeforeUnmount,
    useHoldHeight,
    useT: () => ({ t: (k: string) => k }),
    useI18n: () => ({ locale: ref('en') }),
    useSlideSwipe: () => ({ slide() {} }),
  })
  Month = (await import('../app/components/Month.vue')).default
  Week = (await import('../app/components/Week.vue')).default
})

beforeEach(() => {
  built = 0
})

const panel = (wrapper: { element: Element }, month: string) =>
  wrapper.element.querySelector(`table[data-month="${month}"]`)!.parentElement!

const months = (wrapper: { element: Element }) =>
  [...wrapper.element.querySelectorAll('table[data-month]')].map(t => t.getAttribute('data-month'))

function mountMonth(date: Date) {
  return mount(Month, {
    attachTo: document.body,
    props: { 'date': date, 'onUpdate:date': () => {} },
    slots: {
      day: ({ neighbour }: { neighbour: boolean }) => h('span', { 'data-cell': neighbour ? 'light' : 'full' }),
    },
    global: { stubs },
  })
}

describe('Month panels keyed by month (#3917)', () => {
  // covers: T1
  it('one step forward keeps the two staying panels and builds 4 tables, not 6', async () => {
    const wrapper = mountMonth(new Date(2026, 10, 15))
    expect(months(wrapper)).toEqual(['2026-10', '2026-11', '2026-12'])
    const old = panel(wrapper, '2026-10')
    const nov = panel(wrapper, '2026-11')
    const dec = panel(wrapper, '2026-12')

    await wrapper.setProps({ date: new Date(2026, 11, 15) })

    expect(months(wrapper)).toEqual(['2026-11', '2026-12', '2027-1'])
    expect(panel(wrapper, '2026-11')).toBe(nov)
    expect(panel(wrapper, '2026-12')).toBe(dec)
    expect(built).toBe(4)
    expect(document.contains(old)).toBe(false)
    wrapper.unmount()
  })

  // covers: T2
  it('one step back keeps the two staying panels and builds 4 tables', async () => {
    const wrapper = mountMonth(new Date(2026, 10, 15))
    const oct = panel(wrapper, '2026-10')
    const nov = panel(wrapper, '2026-11')

    await wrapper.setProps({ date: new Date(2026, 9, 15) })

    expect(months(wrapper)).toEqual(['2026-9', '2026-10', '2026-11'])
    expect(panel(wrapper, '2026-10')).toBe(oct)
    expect(panel(wrapper, '2026-11')).toBe(nov)
    expect(built).toBe(4)
    wrapper.unmount()
  })

  // covers: T3
  it('after a step only the middle panel is interactive and full-look', async () => {
    const wrapper = mountMonth(new Date(2026, 10, 15))
    await wrapper.setProps({ date: new Date(2026, 11, 15) })

    const mid = panel(wrapper, '2026-12')
    expect(mid.hasAttribute('inert')).toBe(false)
    expect(mid.hasAttribute('aria-hidden')).toBe(false)
    expect(mid.querySelector('[data-cell]')!.getAttribute('data-cell')).toBe('full')

    for (const side of ['2026-11', '2027-1']) {
      const el = panel(wrapper, side)
      expect(el.hasAttribute('inert')).toBe(true)
      expect(el.getAttribute('aria-hidden')).toBe('true')
      expect(el.querySelector('[data-cell]')!.getAttribute('data-cell')).toBe('light')
    }
    wrapper.unmount()
  })

  // covers: T5
  it('a far jump shows the three months around the target, in order', async () => {
    const wrapper = mountMonth(new Date(2026, 10, 15))
    await wrapper.setProps({ date: new Date(2027, 2, 15) })
    expect(months(wrapper)).toEqual(['2027-2', '2027-3', '2027-4'])
    wrapper.unmount()
  })
})

describe('Week panels keyed by week start (#3917)', () => {
  // covers: T4
  it('one step forward keeps 14 of the 21 day cells as the same elements', async () => {
    const wrapper = mount(Week, {
      attachTo: document.body,
      props: { 'date': new Date(2026, 10, 11), 'onUpdate:date': () => {} },
      global: { stubs },
    })
    const before = [...wrapper.element.querySelectorAll('.group.relative')]
    expect(before).toHaveLength(21)
    // weeks start Mon 2, 9, 16 Nov → cells 0-6, 7-13, 14-20
    const gone = before.slice(0, 7)
    const kept = before.slice(7)

    await wrapper.setProps({ date: new Date(2026, 10, 18) })

    const after = [...wrapper.element.querySelectorAll('.group.relative')]
    expect(after).toHaveLength(21)
    after.slice(0, 14).forEach((el, i) => expect(el).toBe(kept[i]))
    const fresh = after.slice(14)
    expect(fresh.filter(el => before.includes(el))).toHaveLength(0)
    gone.forEach(el => expect(document.contains(el)).toBe(false))
    wrapper.unmount()
  })
})
