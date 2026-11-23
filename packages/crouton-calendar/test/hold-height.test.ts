// @vitest-environment happy-dom
// Height hold (#3924 / #3813): the swipe strip is NEVER shorter than its
// measured height while the month (or week) changes — from finger-up on.
// A hold that starts when the date changes is too late on iOS, so the hold is
// in place for good: set after mount, kept at touchend, before the date
// changes, while the new panel is built, and after it renders. It is
// re-measured when the strip's width changes and goes up if the content grows.
//
// Runs the real Month.vue / Week.vue; only Nuxt UI (UCalendar, UButton) and the
// Nuxt auto-imports are stubbed. happy-dom has no layout, so the strip's box
// (natural height + width, with min-height applied) and ResizeObserver are
// stubbed.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, onBeforeUpdate, ref } from 'vue'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import { useHoldHeight } from '../app/composables/useHoldHeight'

const STRIP = '.overflow-hidden.touch-pan-y'

let recorded: string[] = []
let natural = 304
let width = 360
let swipeOpts: { onNext: () => void, onPrev: () => void } | null = null

const stripEl = () => document.querySelector<HTMLElement>(STRIP)
const record = () => recorded.push(stripEl()?.style.minHeight ?? '<none>')

// Fake layout: the box is the natural height, raised by any min-height.
const realRect = HTMLElement.prototype.getBoundingClientRect
function fakeRect(this: HTMLElement) {
  const min = Number.parseFloat(this.style.minHeight) || 0
  return { width, height: Math.max(natural, min) } as DOMRect
}

// Fake ResizeObserver: `resize()` fires every live observer, like a box change.
const observers = new Set<FakeResizeObserver>()
class FakeResizeObserver {
  constructor(private cb: () => void) {}
  observe() { observers.add(this) }
  unobserve() { observers.delete(this) }
  disconnect() { observers.delete(this) }
  fire() { this.cb() }
}
const resize = () => [...observers].forEach(o => o.fire())
const realRO = globalThis.ResizeObserver

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
  HTMLElement.prototype.getBoundingClientRect = fakeRect
  Object.assign(globalThis, {
    ResizeObserver: FakeResizeObserver,
    ref,
    computed,
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

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect
  globalThis.ResizeObserver = realRO
})

beforeEach(() => {
  vi.useFakeTimers()
  recorded = []
  natural = 304
  width = 360
  swipeOpts = null
  observers.clear()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

// The parent owns the date (v-model:date), like the real pages.
function mountMonthWithParent() {
  const Parent = defineComponent({
    setup() {
      const date = ref(new Date(2026, 10, 15))
      return () => h(Month, { 'date': date.value, 'onUpdate:date': (d: Date) => { date.value = d } })
    },
  })
  const wrapper = mount(Parent, { attachTo: document.body, global: { stubs } })
  recorded = []
  return { wrapper, strip: stripEl()! }
}

function mountMonth(date: Date) {
  const wrapper = mount(Month, {
    attachTo: document.body,
    props: { 'date': date, 'onUpdate:date': () => {} },
    global: { stubs },
  })
  recorded = []
  return { wrapper, strip: stripEl()! }
}

describe('Month strip is never shorter than its measured height (#3924)', () => {
  it('is held from mount on, before any swipe', () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))
    expect(strip.style.minHeight).toBe('304px')
    wrapper.unmount()
  })

  it('the real swipe path: held at touchend, before the date changes, while the new month renders, and after', async () => {
    const { wrapper, strip } = mountMonthWithParent()

    // finger up
    strip.dispatchEvent(new Event('touchend'))
    expect(strip.style.minHeight).toBe('304px')

    // the content shrinks while the panels are swapped — the hold must already be there
    natural = 200
    swipeOpts!.onNext()
    // before the date's re-render runs
    expect(strip.style.minHeight).toBe('304px')
    await nextTick()

    // two staying panels updated + one new panel set up, all while held
    expect(recorded).toEqual(['304px', '304px', '304px'])
    expect(strip.style.minHeight).toBe('304px')

    // and it is never released afterwards
    natural = 304
    vi.advanceTimersByTime(2000)
    resize()
    expect(strip.style.minHeight).toBe('304px')
    expect(stripEl()!.querySelector('[data-month="2026-12"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('two quick month changes stay held throughout', async () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))

    void wrapper.setProps({ date: new Date(2026, 11, 15) })
    await nextTick()
    void wrapper.setProps({ date: new Date(2027, 0, 15) })
    await nextTick()

    expect(recorded.length).toBeGreaterThanOrEqual(6)
    recorded.forEach(v => expect(v).toBe('304px'))
    vi.advanceTimersByTime(2000)
    expect(strip.style.minHeight).toBe('304px')
    wrapper.unmount()
  })

  it('never stops the strip growing: taller content raises the hold', () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))

    natural = 360
    resize()
    expect(strip.style.minHeight).toBe('360px')

    // a brief shrink afterwards does not lower it
    natural = 250
    resize()
    expect(strip.style.minHeight).toBe('360px')
    wrapper.unmount()
  })

  it('a width change re-measures the height from scratch', () => {
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))
    expect(strip.style.minHeight).toBe('304px')

    width = 600
    natural = 280
    resize()
    expect(strip.style.minHeight).toBe('280px')
    wrapper.unmount()
  })

  it('a hidden strip (height 0) gets no min-height, and is held once shown', () => {
    width = 0
    natural = 0
    const { wrapper, strip } = mountMonth(new Date(2026, 10, 15))
    expect(strip.style.minHeight).toBe('')

    width = 360
    natural = 304
    resize()
    expect(strip.style.minHeight).toBe('304px')
    wrapper.unmount()
  })

  it('unmounting disconnects the observer and does not throw', () => {
    const { wrapper } = mountMonth(new Date(2026, 10, 15))
    expect(observers.size).toBe(1)
    expect(() => wrapper.unmount()).not.toThrow()
    expect(observers.size).toBe(0)
  })
})

describe('Week strip is never shorter than its measured height (#3924)', () => {
  it('held from mount on; the 7 new day cells are built while held, and it stays held', async () => {
    const wrapper = mount(Week, {
      attachTo: document.body,
      props: { 'date': new Date(2026, 10, 11), 'onUpdate:date': () => {} },
      slots: { day: () => h(Probe) },
      global: { stubs },
    })
    recorded = []
    const strip = stripEl()!
    expect(strip.style.minHeight).toBe('304px')

    strip.dispatchEvent(new Event('touchend'))
    expect(strip.style.minHeight).toBe('304px')

    natural = 120
    void wrapper.setProps({ date: new Date(2026, 10, 18) })
    await nextTick()

    expect(recorded).toEqual(Array.from({ length: 7 }, () => '304px'))
    vi.advanceTimersByTime(2000)
    resize()
    expect(strip.style.minHeight).toBe('304px')
    wrapper.unmount()
  })
})
