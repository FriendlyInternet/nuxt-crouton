import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed, watch, onMounted, nextTick, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createRequire } from 'node:module'
import { collectionForms } from './mocks/collection-forms'

const hoisted = vi.hoisted(() => ({ sortableOptions: null as any }))

vi.mock('@vueuse/integrations/useSortable', () => ({
  useSortable: (_el: any, _list: any, opts: any) => { hoisted.sortableOptions = opts }
}))
vi.mock('nanoid', () => ({ nanoid: () => 'x' }))

// The SFC relies on Nuxt auto-imports
Object.assign(globalThis, {
  ref, computed, watch, onMounted, nextTick,
  useT: () => ({ t: fakeT })
})

// Echo the key plus its params so tests can read which text was asked for
function fakeT(k: string, p: Record<string, unknown> = {}) {
  const suffix = [p.name, p.position && `${p.position}/${p.total}`].find(Boolean)
  return suffix ? `${k}:${suffix}` : k
}

const guard = createRequire(import.meta.url)('../../../../e2e/console-guard.cjs')

// Picking an item calls onSelect, then the menu's close hook — the order the real menu uses.
const UDropdownMenu = {
  props: ['items', 'content'],
  methods: {
    choose(this: any, it: any) {
      it.onSelect?.(new Event('select'))
      this.content?.onCloseAutoFocus?.(new Event('closeAutoFocus'))
    }
  },
  template: '<div data-testid="menu"><slot /><button v-for="it in items.flat()" type="button" :data-item="it.label" :data-color="it.color" :disabled="it.disabled" @click="choose(it)">{{ it.label }}</button></div>'
}

const stubs = {
  UCard: { template: '<div><slot /></div>' },
  UButton: { inheritAttrs: false, props: ['disabled'], template: '<button v-bind="$attrs" :disabled="disabled"><slot /></button>' },
  UDropdownMenu,
  UIcon: true,
  UAlert: { props: ['title'], template: '<div :data-testid="$attrs[\'data-testid\']">{{ title }}</div>' }
}

async function mountRepeater(componentName: string) {
  const FormRepeater = (await import('../../app/components/FormRepeater.vue')).default
  return mount(FormRepeater, {
    props: { modelValue: [{ id: 'a' }], componentName },
    global: { stubs }
  })
}

let wrapper: VueWrapper<any> | null = null

async function mountRows(ids: string[], extraProps: Record<string, any> = {}) {
  const FormRepeater = (await import('../../app/components/FormRepeater.vue')).default
  wrapper = mount(FormRepeater, {
    props: { modelValue: ids.map(id => ({ id })), componentName: 'KnownInput', ...extraProps },
    global: { stubs },
    attachTo: document.body
  })
  return wrapper
}

async function pick(w: VueWrapper<any>, row: number, label: string) {
  await w.findAll('[data-testid="menu"]')[row]!.find(`[data-item="${label}"]`).trigger('click')
  await nextTick()
  await nextTick()
}

const emittedIds = (w: VueWrapper<any>) =>
  (w.emitted('update:modelValue') || []).map((args: any[]) => args[0].map((i: any) => i.id))

const menuItems = (w: VueWrapper<any>, row: number) =>
  w.findAll('[data-testid="menu"]')[row]!.findAll('[data-item]').map(b => ({
    label: b.attributes('data-item'),
    disabled: b.attributes('disabled') !== undefined,
    color: b.attributes('data-color')
  }))

describe('FormRepeater', () => {
  beforeEach(() => {
    collectionForms.KnownInput = { props: ['modelValue'], render: () => h('span', { class: 'known' }, 'known') }
    hoisted.sortableOptions = null
    vi.restoreAllMocks()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('shows a visible fallback for an unknown component name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = await mountRepeater('MisspelledInput')
    const notice = w.find('[data-testid="repeater-missing-component"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('MisspelledInput')
  })

  it('warns with text the e2e console guard fails on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountRepeater('MisspelledInput')
    const text = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('[CroutonFormRepeater] Failed to resolve component: MisspelledInput'))
    expect(text).toBeTruthy()
    expect(guard.evaluate([{ type: 'warning', text, url: 'x' }])).toHaveLength(1)
  })

  it('renders a known component unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = await mountRepeater('KnownInput')
    expect(w.find('.known').exists()).toBe(true)
    expect(w.find('[data-testid="repeater-missing-component"]').exists()).toBe(false)
    expect(warn.mock.calls.some(c => String(c[0]).includes('CroutonFormRepeater'))).toBe(false)
  })

  // covers: T1
  it('moves the last row up twice from its menu, one emit per pick', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    await pick(w, 2, 'repeater.moveUp')
    await pick(w, 1, 'repeater.moveUp')
    expect(emittedIds(w)).toEqual([['a', 'c', 'b'], ['c', 'a', 'b']])
  })

  // covers: T2
  it('moves the first row down from its menu', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    await pick(w, 0, 'repeater.moveDown')
    expect(emittedIds(w)).toEqual([['b', 'a', 'c']])
  })

  // covers: T3
  it('only offers menu items that can act', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    expect(menuItems(w, 0)).toEqual([
      { label: 'repeater.moveUp', disabled: true, color: undefined },
      { label: 'repeater.moveDown', disabled: false, color: undefined },
      { label: 'common.remove', disabled: false, color: 'error' }
    ])
    expect(menuItems(w, 1).find(i => i.label === 'repeater.moveUp')!.disabled).toBe(false)
    expect(menuItems(w, 2).find(i => i.label === 'repeater.moveDown')!.disabled).toBe(true)
    expect(w.findAll('[data-testid="repeater-row-menu"]')[1]!.attributes('aria-label')).toBe('repeater.actions:2/3')
    w.unmount()

    const unsorted = await mountRows(['a', 'b', 'c'], { sortable: false })
    for (const row of [0, 1, 2]) {
      expect(menuItems(unsorted, row).map(i => i.label)).toEqual(['common.remove'])
    }
    await pick(unsorted, 1, 'common.remove')
    expect(emittedIds(unsorted)).toEqual([['a', 'c']])
    unsorted.unmount()

    const single = await mountRows(['a'])
    expect(menuItems(single, 0).map(i => i.label)).toEqual(['common.remove'])
  })

  // covers: T4
  it('names each row on its trigger and announces the move', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    const labels = w.findAll('[data-testid="repeater-row-menu"]').map(b => b.attributes('aria-label'))
    expect(labels).toEqual(['repeater.actions:1/3', 'repeater.actions:2/3', 'repeater.actions:3/3'])
    await pick(w, 2, 'repeater.moveUp')
    const live = w.find('[data-testid="repeater-live"]')
    expect(live.attributes('aria-live')).toBe('polite')
    expect(live.text()).toBe('repeater.moved:2/3')
    // The live region sits outside the rows container Sortable manages
    expect(w.findAll('[data-testid="menu"]')[0]!.element.parentElement!.parentElement!.parentElement!.contains(live.element)).toBe(false)
  })

  // covers: T5
  it('returns focus to the moved row trigger', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    await pick(w, 2, 'repeater.moveUp')
    expect(document.activeElement).toBe(w.findAll('[data-testid="repeater-row-menu"]')[1]!.element)

    // Move up on that same row again: focus follows it to the top
    await pick(w, 1, 'repeater.moveUp')
    expect(document.activeElement).toBe(w.findAll('[data-testid="repeater-row-menu"]')[0]!.element)
  })

  // covers: T6
  it('dragging gives the same update as the menu', async () => {
    // Mount A: the menu path, Move up twice on row 3
    const byMenu = await mountRows(['a', 'b', 'c'])
    await pick(byMenu, 2, 'repeater.moveUp')
    await pick(byMenu, 1, 'repeater.moveUp')
    const menuResult = emittedIds(byMenu).at(-1)
    byMenu.unmount()

    // Mount B: the drag path, Sortable's onUpdate from row 3 to the top
    const byDrag = await mountRows(['a', 'b', 'c'])
    expect(hoisted.sortableOptions).toBeTruthy()
    hoisted.sortableOptions.onUpdate({ oldIndex: 2, newIndex: 0 })
    await nextTick()
    const dragResult = emittedIds(byDrag).at(-1)

    expect(menuResult).toEqual(['c', 'a', 'b'])
    expect(dragResult).toEqual(menuResult)
  })

  // covers: T7
  it('removes a row from its menu next to the move items, focus going to the next row', async () => {
    const w = await mountRows(['a', 'b', 'c'])
    expect(menuItems(w, 1).map(i => i.label)).toEqual(['repeater.moveUp', 'repeater.moveDown', 'common.remove'])
    await pick(w, 1, 'common.remove')
    expect(emittedIds(w)).toEqual([['a', 'c']])
    const triggers = w.findAll('[data-testid="repeater-row-menu"]')
    expect(triggers).toHaveLength(2)
    // The row that took the removed row's place now has focus
    expect(document.activeElement).toBe(triggers[1]!.element)
  })
})
