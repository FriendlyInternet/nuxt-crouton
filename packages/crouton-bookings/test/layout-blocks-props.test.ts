// @vitest-environment happy-dom
/**
 * #3651 — the List, Filters and Locations layout blocks take props and emit
 * events. Mounted with props only: no store, no fetch. The child components
 * (`CroutonBookingsList`, `CroutonBookingsPanelFilters`, `UIcon`) are stubbed;
 * `useT` is stubbed on globalThis (a Nuxt auto-import).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import LayoutList from '../app/components/Layout/List.vue'
import LayoutFilters from '../app/components/Layout/Filters.vue'
import LayoutLocations from '../app/components/Layout/Locations.vue'

beforeAll(() => {
  ;(globalThis as any).useT = () => ({ t: (k: string) => k })
})

const ListStub = defineComponent({
  name: 'CroutonBookingsList',
  props: ['bookings', 'loading', 'error', 'hasActiveFilters', 'activeLocationFilter', 'selectedDate', 'highlightedBookingId', 'scrollTarget', 'creatingAtDate', 'isDayFullyBooked', 'scrollRoot'],
  emits: ['date-click', 'new-booking', 'created', 'cancel-create'],
  setup: () => () => h('div', { 'data-stub': 'list' }),
})
const FiltersStub = defineComponent({
  name: 'CroutonBookingsPanelFilters',
  props: ['locations', 'selectedLocations', 'showCancelled', 'canManageLocations', 'viewToggles'],
  setup: () => () => h('div', { 'data-stub': 'filters' }),
})
// Stubs declare their props, so a test reads exactly what the block passed down.
const stubs = { CroutonBookingsList: ListStub, CroutonBookingsPanelFilters: FiltersStub, UIcon: true }

const day = new Date(2026, 10, 20)
const bookings = [{ id: 'b1', date: '2026-11-20', status: 'confirmed', location: 'a' }] as any

describe('layout blocks are fed by props (#3651)', () => {
  // covers: T1
  it('List passes the store state through to CroutonBookingsList', async () => {
    const fullyBooked = () => false
    const w = mount(LayoutList, {
      props: {
        bookings,
        loading: false,
        selectedDate: day,
        highlightedBookingId: 'b1',
        scrollTarget: day,
        creatingAt: day,
        hasActiveFilters: true,
        activeLocationFilter: ['a'],
        isDayFullyBooked: fullyBooked,
      },
      global: { stubs },
    })
    await w.vm.$nextTick()
    const list = w.findComponent(ListStub)
    const passed = list.props() as Record<string, unknown>
    expect(list.exists()).toBe(true)
    expect(passed.bookings).toEqual(bookings)
    expect(passed.selectedDate).toBe(day)
    expect(passed.highlightedBookingId).toBe('b1')
    expect(passed.scrollTarget).toBe(day)
    expect(passed.creatingAtDate).toBe(day)
    expect(passed.hasActiveFilters).toBe(true)
    expect(passed.activeLocationFilter).toEqual(['a'])
    expect(passed.isDayFullyBooked).toBe(fullyBooked)
    expect(passed.scrollRoot).toBeInstanceOf(HTMLElement)
  })

  // covers: T1
  it('List without props renders an empty list (does not fetch)', () => {
    const w = mount(LayoutList, { global: { stubs } })
    const passed = w.findComponent(ListStub).props() as Record<string, unknown>
    // `[]`, not undefined: CroutonBookingsList loads its own data when bookings is undefined.
    expect(passed.bookings).toEqual([])
  })

  // covers: T1
  it('List re-emits dateClick, newBooking, created and cancel', async () => {
    const w = mount(LayoutList, { props: { bookings }, global: { stubs } })
    const list = w.findComponent(ListStub)
    list.vm.$emit('date-click', day)
    list.vm.$emit('new-booking', day)
    list.vm.$emit('created')
    list.vm.$emit('cancel-create')
    expect(w.emitted('dateClick')).toEqual([[day]])
    expect(w.emitted('newBooking')).toEqual([[day]])
    expect(w.emitted('created')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  // covers: T1
  it('Filters emits update:filters with the new showCancelled / locations', () => {
    const filters = { statuses: [], locations: ['a'], showCancelled: false }
    const w = mount(LayoutFilters, {
      props: { filters, locations: [{ id: 'a' }, { id: 'b' }] as any, canManageLocations: true },
      global: { stubs },
    })
    const f = w.findComponent(FiltersStub)
    const passed = f.props() as Record<string, unknown>
    expect(passed.selectedLocations).toEqual(['a'])
    expect(passed.showCancelled).toBe(false)
    expect(passed.canManageLocations).toBe(true)
    expect(passed.viewToggles).toBe(false)
    f.vm.$emit('update:show-cancelled', true)
    f.vm.$emit('update:selected-locations', ['a', 'b'])
    f.vm.$emit('add-location')
    f.vm.$emit('edit-location', { id: 'a' })
    expect(w.emitted('update:filters')).toEqual([
      [{ statuses: [], locations: ['a'], showCancelled: true }],
      [{ statuses: [], locations: ['a', 'b'], showCancelled: false }],
    ])
    expect(w.emitted('add-location')).toHaveLength(1)
    expect(w.emitted('edit-location')).toEqual([[{ id: 'a' }]])
  })

  // covers: T1
  it('Locations renders one button per location, marks the selected ones, and emits toggle-location', async () => {
    const w = mount(LayoutLocations, {
      props: { locations: [{ id: 'a', title: 'Hall A' }, { id: 'b', title: { en: 'Hall B' } }] as any, selectedLocations: ['b'] },
      global: { stubs },
    })
    const buttons = w.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.text()).toContain('Hall A')
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false')
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true')
    await buttons[0]!.trigger('click')
    expect(w.emitted('toggle-location')).toEqual([['a']])
  })

  // covers: T1
  it('none of the three blocks loads data or uses the old shared filter composable', () => {
    for (const file of ['List.vue', 'Filters.vue', 'Locations.vue']) {
      const src = readFileSync(resolve(__dirname, '../app/components/Layout', file), 'utf8')
      expect(src, file).not.toMatch(/useBookingsList\(|useBookingsLayoutFilters\(|useCrouton\(|useTeam\(/)
    }
  })
})
