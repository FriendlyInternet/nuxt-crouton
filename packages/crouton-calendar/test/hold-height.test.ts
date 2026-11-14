// @vitest-environment happy-dom
// Height hold (#3924 / #3813): while the shown month (or week) changes, the
// swipe strip is never shorter than it was just before the change — otherwise
// WebKit clamps the page scroll and the page jumps. Runs the real Month.vue /
// Week.vue; only Nuxt UI (UCalendar, UButton) and the Nuxt auto-imports are
// stubbed. happy-dom has no layout, so the strip's height is stubbed and the
// test checks the hold is in place while the cells are patched/built.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onBeforeUpdate, ref, watch } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { useHoldHeight } from '../app/composables/useHoldHeight'

const STRIP = '.overflow-hidden.touch-pan-y'

let recorded: string[] = []
let height = 304
let swipeOpts: { onNext: () => void, onPrev: () => void } | null = null

const stripEl = () => document.querySelector<HTMLElement>(STRIP)
const record = () => recorded.push(stripEl()?.style.minHeight ?? '<none>')

// Records the strip's min-height whenever a UCalendar body is built or patched.
const DayHost = defineComponent({
  setup(_, { slots }) {
    record()
    onBeforeUpdate(record)
    return () => h('tbody', slots.default?.())
  },
})

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

// Placed in Week's #day slot: records when a new day cell is built.
const Probe = defineComponent({
  setup() {
    record()
    return () => h('span')
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
    useSlideSwipe: (_el: unknown, opts: { onNext: () => void, onPrev: () => void }) => {
      swipeOpts = opts
      return { slide() {} }
    },
  })
  Month = (await import('../app/components/Month.vue')).default
  Week = (await import('../app/components/Week.vue')).default
})

beforeEach(() => {
  vi.useFakeTimers()
  recorded = []
  height = 304
  swipeOpts = null
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// Give the strip a layout height (happy-dom has none) and clear the mount-time records.
function prepareStrip() {
  const el = stripEl()!
  el.getBoundingClientRect = () => ({ height } as DOMRect)
  recorded = []
  return el
}

function mountMonth(date: Date) {
  const wrapper = mount(Month, {
    attachTo: document.body,
    props: { 'date': date, 'onUpdate:date': () => {} },
    global: { stubs },
  })
  return { wrapper, strip: prepareStrip() }
}

describe('Month strip keeps its height while the month changes (#3924)', () => {
  // covers: T1, T2
  it('is held while the panels are swapped, and released on the next frame', async () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))
    expect(strip.style.minHeight).toBe('')

    void wrapper.setProps({ date: new Date(2026, 11, 15) })
    await nextTick()

    // two staying panels updated + one new panel set up
    expect(recorded).toEqual(['304px', '304px', '304px'])
    expect(strip.style.minHeight).toBe('304px')

    vi.advanceTimersToNextFrame()
    expect(strip.style.minHeight).toBe('')
    wrapper.unmount()
  })

  // covers: T3
  it('two changes before a frame stay held and leave no stray release', async () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))

    void wrapper.setProps({ date: new Date(2026, 11, 15) })
    await nextTick()
    void wrapper.setProps({ date: new Date(2027, 0, 15) })
    await nextTick()

    expect(recorded.length).toBeGreaterThanOrEqual(6)
    recorded.forEach(v => expect(v).toBe('304px'))

    vi.advanceTimersToNextFrame()
    expect(strip.style.minHeight).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })

  // covers: T4
  it('the real swipe path (onNext → parent v-model:date) is held', async () => {
    const Parent = defineComponent({
      setup() {
        const date = ref(new Date(2026, 10, 15))
        return () => h(Month, { 'date': date.value, 'onUpdate:date': (d: Date) => { date.value = d } })
      },
    })
    const wrapper = mount(Parent, { attachTo: document.body, global: { stubs } })
    const strip = prepareStrip()

    swipeOpts!.onNext()
    await nextTick()

    expect(recorded).toEqual(['304px', '304px', '304px'])
    expect(strip.style.minHeight).toBe('304px')
    wrapper.unmount()
  })

  // covers: T6
  it('a hidden strip (height 0) is never given a min-height', async () => {
    height = 0
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))

    void wrapper.setProps({ date: new Date(2026, 11, 15) })
    await nextTick()

    expect(strip.style.minHeight).toBe('')
    wrapper.unmount()
  })

  // covers: T7
  it('unmounting with a release pending does not throw and leaves no timer', async () => {
    const { wrapper } = mountMonth(new Date(2026, 10, 15))

    void wrapper.setProps({ date: new Date(2026, 11, 15) })
    await nextTick()

    expect(() => wrapper.unmount()).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Week strip keeps its height while the week changes (#3924)', () => {
  // covers: T5
  it('the 7 new day cells are built while held, released after one frame', async () => {
    const wrapper = mount(Week, {
      attachTo: document.body,
      props: { 'date': new Date(2026, 10, 11), 'onUpdate:date': () => {} },
      slots: { day: () => h(Probe) },
      global: { stubs },
    })
    const strip = prepareStrip()

    void wrapper.setProps({ date: new Date(2026, 10, 18) })
    await nextTick()

    expect(recorded).toEqual(Array.from({ length: 7 }, () => '304px'))

    vi.advanceTimersToNextFrame()
    expect(strip.style.minHeight).toBe('')
    wrapper.unmount()
  })
})
