// @vitest-environment happy-dom
/**
 * #4302 — on a phone, tapping a booked slot mark fired a fake `mouseenter` (and no
 * `mouseleave`), so `hoverBooking` stuck on one booking and the list showed only it.
 * The mark's hover now reacts to mouse/pen pointer events only; touch is ignored.
 * Compiles and mounts the real Slot/Indicator.vue (one auto-import, stubbed).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import type { Component } from 'vue'
import { mount } from '@vue/test-utils'
import ts from 'typescript'

const file = resolve(__dirname, '../app/components/Slot/Indicator.vue')
let Indicator: Component

beforeAll(async () => {
  const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
  const script = compileScript(descriptor, { id: 'slot-indicator-touch', inlineTemplate: true })
  const js = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText
  // Under happy-dom an import from os.tmpdir() can't resolve; a gitignored dir in the package can.
  const dir = resolve(__dirname, '../node_modules/.cache/slot-indicator-touch')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'Indicator.mjs')
  writeFileSync(out, js)
  ;(globalThis as any).useBookingSlots = () => ({ parseSlotIds: (s: unknown) => (Array.isArray(s) ? s : []) })
  Indicator = (await import(/* @vite-ignore */ out)).default
})

function mountIndicator(props: Record<string, unknown> = {}) {
  return mount(Indicator, {
    props: {
      slots: [{ id: 'a' }, { id: 'b' }],
      bookedSlotIds: ['a'],
      bookings: [{ id: 'bk1', slot: ['a'] }],
      ...props
    }
  })
}

function mark(wrapper: ReturnType<typeof mountIndicator>, i: number): Element {
  return wrapper.element.children[i] as Element
}

function pointer(el: Element, type: 'pointerenter' | 'pointerleave', pointerType: string) {
  el.dispatchEvent(new PointerEvent(type, { pointerType }))
}

function compatMouse(el: Element, type: 'mouseenter' | 'mouseleave') {
  el.dispatchEvent(new MouseEvent(type))
}

describe('Slot indicator hover ignores touch (#4302)', () => {
  it('T1 — a phone tap on a booked mark never emits hoverBooking', async () => {
    const w = mountIndicator()
    pointer(mark(w, 0), 'pointerenter', 'touch')
    compatMouse(mark(w, 0), 'mouseenter')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toBeUndefined()
  })

  it('T2 — mouse enter emits the booking, mouse leave emits null', async () => {
    const w = mountIndicator()
    pointer(mark(w, 0), 'pointerenter', 'mouse')
    pointer(mark(w, 0), 'pointerleave', 'mouse')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toEqual([['bk1'], [null]])
  })

  it('T3 — pen enter emits the booking, like the mouse', async () => {
    const w = mountIndicator()
    pointer(mark(w, 0), 'pointerenter', 'pen')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toEqual([['bk1']])
  })

  it('T4 — a touch leave emits nothing', async () => {
    const w = mountIndicator()
    pointer(mark(w, 0), 'pointerleave', 'touch')
    compatMouse(mark(w, 0), 'mouseleave')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toBeUndefined()
  })

  it('T5 — mouse enter on an empty mark is ignored; the booked mark still reacts', async () => {
    const w = mountIndicator()
    pointer(mark(w, 1), 'pointerenter', 'mouse')
    pointer(mark(w, 0), 'pointerenter', 'mouse')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toEqual([['bk1']])
  })

  it('T6 — a phone tap on a partly booked mark emits nothing', async () => {
    const w = mountIndicator({ partialSlotIds: ['a'], bookedSlotIds: [] })
    pointer(mark(w, 0), 'pointerenter', 'touch')
    compatMouse(mark(w, 0), 'mouseenter')
    await w.vm.$nextTick()
    expect(w.emitted('hoverBooking')).toBeUndefined()
  })
})
