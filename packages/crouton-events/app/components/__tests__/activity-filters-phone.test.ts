// @vitest-environment happy-dom
/**
 * #4036 phone layout — below `sm` the collection/action/user selects fold into one
 * "Filtres" button (opens a bottom drawer) with a badge counting the active filters.
 * Mounts the real CroutonActivityFilters at a real 390px happy-dom viewport, so the
 * real `useMediaQuery` decides the layout. Nuxt UI parts are stubbed (there is no Nuxt
 * app in a unit test); the stubs only render and emit what the component wires to them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import fr from '../../../i18n/locales/fr.json'
import CroutonActivityFilters from '../CroutonActivityFilters.vue'
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
const USelectMenu = defineComponent({
  name: 'USelectMenu',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(_p, { attrs }) {
    return () => h('div', { ...attrs, 'data-select': '' })
  }
})
// Like the real drawer: clicking the trigger opens it, the body renders only while open
const UDrawer = defineComponent({
  name: 'UDrawer',
  props: { open: { type: Boolean, default: false } },
  emits: ['update:open'],
  setup(p, { slots, emit }) {
    return () => h('div', { 'data-drawer': '' }, [
      h('div', { 'data-trigger': '', 'onClick': () => emit('update:open', true) }, slots.default?.()),
      p.open ? h('div', { 'data-drawer-body': '' }, slots.body?.()) : null
    ])
  }
})
const UTabs = defineComponent({
  name: 'UTabs',
  setup() {
    return () => h('div', { 'data-tabs': '' })
  }
})

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('useI18n', () => ({ t: translate }))
  vi.stubGlobal('useAppConfig', () => ({ croutonCollections: {} }))
  vi.stubGlobal('eventCollectionLabel', eventCollectionLabel)
})

async function mountAt(width: number) {
  ;(window as any).happyDOM.setViewport({ width, height: 800 })
  const wrapper = mount(CroutonActivityFilters, {
    props: {
      'modelValue': {} as FilterState,
      'collections': ['pages'],
      'users': [{ id: 'u1', name: 'Anna' }],
      'onUpdate:modelValue': (value: FilterState) => wrapper.setProps({ modelValue: value })
    },
    global: { components: { UButton, UBadge, USelectMenu, UDrawer, UTabs } }
  })
  await nextTick()
  return wrapper
}

describe('activity filters at phone width (#4036)', () => {
  it('at 390px shows one "Filtres" button and no inline selects; the badge shows 1 after one filter is set', async () => {
    const wrapper = await mountAt(390)

    const toggle = wrapper.find('.crouton-activity-filters-toggle')
    expect(toggle.exists()).toBe(true)
    expect(toggle.text()).toContain('Filtres')
    expect(toggle.attributes('data-icon')).toBe('i-lucide-sliders-horizontal')
    expect(wrapper.findAll('[data-select]')).toHaveLength(0)
    expect(wrapper.find('[data-badge]').exists()).toBe(false)

    // Open the drawer: the same three selects, plus no "clear" while nothing is set
    await toggle.trigger('click')
    const selects = wrapper.findAllComponents(USelectMenu)
    expect(selects.map(s => s.attributes('aria-label'))).toEqual(['Collection', 'Action', 'Personne'])
    expect(wrapper.find('[data-drawer-body]').text()).not.toContain('Effacer les filtres')

    // Pick an action in the drawer
    selects[1]!.vm.$emit('update:modelValue', 'update')
    await nextTick()

    const badge = wrapper.find('[data-badge]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
    expect(wrapper.find('[data-drawer-body]').text()).toContain('Effacer les filtres')
    expect(wrapper.find('[data-drawer-body]').findAll('[data-select]')).toHaveLength(3)
  })

  it('at desktop width keeps the three inline selects and no "Filtres" button', async () => {
    const wrapper = await mountAt(1280)
    expect(wrapper.findAll('[data-select]')).toHaveLength(3)
    expect(wrapper.find('.crouton-activity-filters-toggle').exists()).toBe(false)
  })
})
