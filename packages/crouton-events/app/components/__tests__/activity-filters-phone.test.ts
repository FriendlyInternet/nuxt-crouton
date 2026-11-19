// @vitest-environment happy-dom
/**
 * #4036 phone layout — below `sm` the page header carries one button group (Actualiser ·
 * Filtres · Exporter). "Filtres" opens a bottom drawer holding the collection/action/person
 * selects and shows a badge counting the active filters; no select sits inline.
 * Mounts the real CroutonActivityFilters + CroutonActivityHeaderActions, wired the way the
 * page wires them, at a real 390px happy-dom viewport so the real `useMediaQuery` decides
 * the layout. Nuxt UI parts are stubbed (there is no Nuxt app in a unit test); the stubs only
 * render and emit what the components wire to them — except the select menu stub, which on
 * open applies the same guard reka-ui's ComboboxItem applies (it throws on an empty-string
 * item value: the "Erreur 500" crash).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import fr from '../../../i18n/locales/fr.json'
import CroutonActivityFilters from '../CroutonActivityFilters.vue'
import CroutonActivityHeaderActions from '../CroutonActivityHeaderActions.vue'
import { eventCollectionLabel } from '../../utils/event-display'
import type { FilterState } from '../../types/events'

function translate(key: string, params?: Record<string, unknown>): string {
  const value = key.split('.').reduce<any>((node, part) => node?.[part], fr)
  if (typeof value !== 'string') return key
  const n = Number(params?.n ?? 1)
  const forms = value.split(' | ')
  const text = forms.length > 1 && n !== 1 ? forms[1]! : forms[0]!
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''))
}

const UButton = defineComponent({
  name: 'UButton',
  props: { label: { type: String, default: undefined }, icon: { type: String, default: undefined } },
  emits: ['click'],
  setup(p, { slots, emit, attrs }) {
    return () => h('button', { ...attrs, 'data-icon': p.icon, 'onClick': () => emit('click') }, [p.label, slots.trailing?.()])
  }
})
const UBadge = defineComponent({
  name: 'UBadge',
  props: { label: { type: [String, Number], default: undefined } },
  setup(p, { attrs }) {
    return () => h('span', { ...attrs, 'data-badge': '' }, String(p.label))
  }
})
// Opening the menu renders its items; like reka-ui's ComboboxItem, an empty-string value throws
const USelectMenu = defineComponent({
  name: 'USelectMenu',
  props: {
    modelValue: { type: String, default: undefined },
    items: { type: Array as () => Array<{ label: string, value: string }>, default: () => [] }
  },
  emits: ['update:modelValue'],
  setup(p, { attrs }) {
    const open = ref(false)
    return () => h('div', { ...attrs, 'data-select': '', 'data-value': p.modelValue }, [
      h('span', { 'data-select-trigger': '', 'onClick': () => { open.value = true } }),
      open.value
        ? p.items.map((item) => {
            if (item.value === '') throw new Error('A <ComboboxItem /> must have a value prop that is not an empty string.')
            return h('span', { 'data-item': item.value }, item.label)
          })
        : null
    ])
  }
})
// Like the real drawer: the body renders only while open
const UDrawer = defineComponent({
  name: 'UDrawer',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  setup(p, { slots }) {
    return () => h('div', { 'data-drawer': '' }, [
      p.open ? h('div', { 'data-drawer-body': '' }, slots.body?.()) : null
    ])
  }
})
const UTabs = defineComponent({
  name: 'UTabs',
  setup(_p, { attrs }) {
    return () => h('div', { ...attrs, 'data-tabs': '' })
  }
})
const UFieldGroup = defineComponent({
  name: 'UFieldGroup',
  setup(_p, { slots, attrs }) {
    return () => h('div', { ...attrs, 'data-field-group': '' }, slots.default?.())
  }
})
const UDropdownMenu = defineComponent({
  name: 'UDropdownMenu',
  setup(_p, { slots }) {
    return () => h('div', { 'data-dropdown': '' }, slots.default?.())
  }
})

const components = { UButton, UBadge, USelectMenu, UDrawer, UTabs, UFieldGroup, UDropdownMenu }

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('useI18n', () => ({ t: translate }))
  vi.stubGlobal('useAppConfig', () => ({ croutonCollections: {} }))
  vi.stubGlobal('eventCollectionLabel', eventCollectionLabel)
})

// Wired like pages/admin/[team]/activity.vue + CroutonActivityLog: the header's "Filtres"
// opens the filters' drawer and shows the filters' exposed count.
const ActivityHarness = defineComponent({
  setup() {
    const filters = ref<FilterState>({})
    const filtersRef = ref<{ openDrawer: () => void, activeFilterCount: number } | null>(null)
    return () => h('div', [
      h('header', [
        h(CroutonActivityHeaderActions, {
          filterCount: filtersRef.value?.activeFilterCount ?? 0,
          onFilters: () => filtersRef.value?.openDrawer()
        })
      ]),
      h(CroutonActivityFilters, {
        'ref': filtersRef,
        'modelValue': filters.value,
        'collections': ['pages'],
        'users': [{ id: 'u1', name: 'Anna' }],
        'onUpdate:modelValue': (value: FilterState) => { filters.value = value }
      })
    ])
  }
})

async function mountAt(width: number, component: any = ActivityHarness, props: Record<string, unknown> = {}) {
  ;(window as any).happyDOM.setViewport({ width, height: 800 })
  const wrapper = mount(component, { props, global: { components } })
  await nextTick()
  return wrapper
}

// A select is "shown at phone width" unless it sits in the drawer body or inside an
// ancestor that Tailwind hides below `sm` (`hidden` without a narrower override).
function visibleAtPhone(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('data-drawer-body')) return false
    if (node.classList.contains('hidden')) return false
  }
  return true
}

describe('activity filters at phone width (#4036)', () => {
  it('at 390px shows one "Filtres" button and no inline selects; the badge shows 1 after one filter is set', async () => {
    const wrapper = await mountAt(390)

    // The header group: exactly Actualiser · Filtres · Exporter, icon-only, each with an aria-label
    const group = wrapper.find('header [data-field-group]')
    expect(group.exists()).toBe(true)
    const buttons = group.findAll('button')
    expect(buttons.map(b => b.attributes('aria-label'))).toEqual(['Actualiser', 'Filtres', 'Exporter'])
    expect(buttons.map(b => b.attributes('data-icon'))).toEqual(['i-lucide-refresh-cw', 'i-lucide-sliders-horizontal', 'i-lucide-download'])
    for (const b of buttons) expect(b.text()).toBe('')

    // No filter control inline: no select, no "Filtres" text button outside the header, no badge at 0
    expect(wrapper.findAll('[data-select]')).toHaveLength(0)
    expect(wrapper.findAll('.crouton-activity-filters-toggle')).toHaveLength(1)
    expect(wrapper.find('.crouton-activity-filters [data-icon="i-lucide-sliders-horizontal"]').exists()).toBe(false)
    expect(wrapper.find('[data-badge]').exists()).toBe(false)

    // The period bar is full width
    expect(wrapper.find('[data-tabs]').classes()).toContain('w-full')

    // Filtres opens the drawer: the three selects, full width, no "clear" while nothing is set
    await wrapper.find('.crouton-activity-filters-toggle').trigger('click')
    const selects = wrapper.findAllComponents(USelectMenu)
    expect(selects.map(s => s.attributes('aria-label'))).toEqual(['Collection', 'Action', 'Personne'])
    for (const s of selects) expect(s.classes()).toContain('w-full')
    expect(wrapper.find('[data-drawer-body]').text()).not.toContain('Effacer les filtres')

    // Pick an action in the drawer
    selects[1]!.vm.$emit('update:modelValue', 'update')
    await nextTick()

    const badge = wrapper.find('header [data-badge]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
    expect(wrapper.find('[data-drawer-body]').text()).toContain('Effacer les filtres')
    expect(wrapper.find('[data-drawer-body]').findAll('[data-select]')).toHaveLength(3)
  })

  it('at 390px no collection select is shown outside the drawer — through the real server render and hydration', async () => {
    ;(window as any).happyDOM.setViewport({ width: 390, height: 800 })
    const props = { modelValue: {} as FilterState, collections: ['pages'], users: [{ id: 'u1', name: 'Anna' }] }
    const makeApp = () => {
      const app = createSSRApp(CroutonActivityFilters, props)
      for (const [name, c] of Object.entries(components)) app.component(name, c)
      return app
    }

    // 1. Server render: the server has no matchMedia, so it renders the desktop branch.
    //    Even that markup must not show a select at phone width (CSS-hidden below `sm`).
    const matchMedia = window.matchMedia
    ;(window as any).matchMedia = undefined
    const html = await renderToString(makeApp())
    ;(window as any).matchMedia = matchMedia
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.appendChild(root)
    expect(root.querySelectorAll('[data-select]').length).toBeGreaterThan(0)
    expect([...root.querySelectorAll('[data-select]')].filter(visibleAtPhone)).toHaveLength(0)

    // 2. The phone hydrates that markup, then settles: no inline select at all
    const app = makeApp()
    app.config.warnHandler = () => {}
    const vm = app.mount(root) as unknown as { openDrawer: () => void }
    await nextTick()
    await nextTick()
    expect(root.querySelectorAll('[aria-label="Collection"]')).toHaveLength(0)
    expect(root.querySelectorAll('[data-select]')).toHaveLength(0)

    // 3. Opening the drawer (what the header's "Filtres" calls): the collection select lives only inside it
    vm.openDrawer()
    await nextTick()
    const collection = [...root.querySelectorAll('[aria-label="Collection"]')]
    expect(collection).toHaveLength(1)
    expect(collection[0]!.closest('[data-drawer-body]')).not.toBeNull()
    expect([...root.querySelectorAll('[data-select]')].filter(visibleAtPhone)).toHaveLength(0)
    app.unmount()
    root.remove()
  })

  it('at desktop width keeps the three inline selects and no "Filtres" button', async () => {
    const wrapper = await mountAt(1280, CroutonActivityFilters, { modelValue: {}, collections: ['pages'], users: [{ id: 'u1', name: 'Anna' }] })
    expect(wrapper.findAll('[data-select]')).toHaveLength(3)
    expect(wrapper.find('.crouton-activity-filters-toggle').exists()).toBe(false)
  })
})

describe('activity filter menus open without crashing (#4036 "Erreur 500")', () => {
  it('each of the three menus opens without an error, and choosing "all" clears that filter', async () => {
    const updates: FilterState[] = []
    const wrapper = await mountAt(1280, CroutonActivityFilters, {
      'modelValue': { collectionName: 'pages', operation: 'update', userId: 'u1' } as FilterState,
      'collections': ['pages'],
      'users': [{ id: 'u1', name: 'Anna' }],
      'onUpdate:modelValue': (value: FilterState) => { updates.push(value) }
    })

    const selects = wrapper.findAllComponents(USelectMenu)
    expect(selects).toHaveLength(3)
    for (const select of selects) {
      // Opening renders the items — it threw on the old `value: ''` "all" items
      await select.find('[data-select-trigger]').trigger('click')
      expect(select.find('[data-item="all"]').exists()).toBe(true)
      expect(select.findAll('[data-item=""]')).toHaveLength(0)
    }

    // Choosing "all" in each menu clears just that filter (back to `undefined`)
    selects[0]!.vm.$emit('update:modelValue', 'all')
    selects[1]!.vm.$emit('update:modelValue', 'all')
    selects[2]!.vm.$emit('update:modelValue', 'all')
    expect(updates[0]).toMatchObject({ collectionName: undefined, operation: 'update', userId: 'u1' })
    expect(updates[1]).toMatchObject({ collectionName: 'pages', operation: undefined, userId: 'u1' })
    expect(updates[2]).toMatchObject({ collectionName: 'pages', operation: 'update', userId: undefined })
  })

  it('with no filter set, each menu shows its "all" item as the selected value', async () => {
    const wrapper = await mountAt(1280, CroutonActivityFilters, { modelValue: {}, collections: ['pages'], users: [{ id: 'u1', name: 'Anna' }] })
    expect(wrapper.findAll('[data-select]').map(s => s.attributes('data-value'))).toEqual(['all', 'all', 'all'])
  })
})
