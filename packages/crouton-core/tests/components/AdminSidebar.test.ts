/**
 * AdminSidebar — a group that should start open stays open when another group
 * appears after mount (#4394).
 *
 * The Team group comes from `useTeamAdminPages()`, whose `useCan` answers read
 * false while loading, so it is missing at first and appears a moment later.
 * Nuxt UI's vertical `UNavigationMenu` reads `defaultOpen` once at mount and
 * remembers open groups by `value`, falling back to the position (`item-<n>`).
 * Before the fix, Team arriving pushed Bookings down one position, so its
 * remembered slot pointed at the wrong group and Bookings → Locations was
 * folded away (the with-bookings e2e "bookings admin section renders" failure).
 *
 * `UNavigationMenu` is replaced by a stub that copies those two Nuxt UI rules
 * (`getItemValue` / `getAccordionDefaultValue` in @nuxt/ui 4.x
 * NavigationMenu.vue): the real component needs the Nuxt runtime, which this
 * suite does not boot. The e2e surface check runs the real one.
 */
import { describe, it, expect } from 'vitest'
import { ref, computed, shallowRef, onMounted, nextTick, defineComponent, h, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import { teamAdminPages, toSidebarItems } from '../../../crouton-admin/app/utils/team-pages'

const TEAM = 'e2e-team'
const canAnswersLoaded = ref(false)

const bookingsApp = {
  id: 'bookings',
  name: 'Bookings',
  icon: 'i-lucide-calendar',
  routes: [
    { path: '/bookings', label: 'Overview' },
    { path: '/bookings/locations', label: 'Locations' },
    { path: '/bookings/settings', label: 'Settings' }
  ]
}

Object.assign(globalThis, {
  ref, computed, shallowRef, onMounted,
  resolveComponent: (name: string) => name,
  useT: () => ({ t: (k: string) => k }),
  useRoute: () => ({ path: `/admin/${TEAM}/bookings` }),
  useTeamContext: () => ({ teamSlug: ref(TEAM), teamId: ref('t1'), hasTeamContext: ref(true) }),
  useCroutonApps: () => ({
    topLevelApps: computed(() => [bookingsApp]),
    getAppAllRoutes: () => bookingsApp.routes
  }),
  useCroutonCollectionsNav: () => ({
    collectionsByKind: computed(() => [
      { kind: 'content', label: 'Content', icon: 'i-lucide-file', items: [{ name: 'mainItems', label: 'Main Items', icon: 'i-lucide-box', order: 0 }] },
      { kind: 'media', label: 'Media', icon: 'i-lucide-image', items: [{ name: 'images', label: 'Images', icon: 'i-lucide-image', order: 0 }] }
    ])
  }),
  // Real list + real "answers still loading → nothing" rule, from crouton-admin.
  useTeamAdminPages: () => computed(() => teamAdminPages(TEAM, () => canAnswersLoaded.value)),
  toSidebarItems
})

interface Item { value?: string, label?: string, to?: string, defaultOpen?: boolean, children?: Item[] }

// Same open-state rules as Nuxt UI's vertical NavigationMenu (see header).
const NavigationMenuStub = defineComponent({
  props: { items: { type: Array as PropType<Item[]>, default: () => [] } },
  setup(props) {
    const valueOf = (item: Item, index: number) => item.value ?? `item-${index}`
    const open = props.items.reduce<string[]>((acc, item, index) => {
      if (item.defaultOpen) acc.push(valueOf(item, index))
      return acc
    }, [])
    return () => h('ul', props.items.map((item, index) => h('li', [
      item.to ? h('a', { href: item.to }, item.label) : h('span', item.label),
      item.children?.length
        ? h('ul', { hidden: !open.includes(valueOf(item, index)) }, item.children.map(child => h('li', [h('a', { href: child.to }, child.label)])))
        : null
    ])))
  }
})

const stubs = {
  UDashboardSidebar: { template: '<aside><slot name="header" :collapsed="false" /><slot :collapsed="false" /></aside>' },
  UNavigationMenu: NavigationMenuStub,
  UIcon: true
}

async function mountSidebar() {
  const AdminSidebar = (await import('../../app/components/AdminSidebar.vue')).default
  return mount(AdminSidebar, { global: { stubs } })
}

function isFolded(link: Element | null): boolean {
  for (let el = link; el; el = el.parentElement) {
    if (el.hasAttribute('hidden')) return true
  }
  return false
}

describe('AdminSidebar open groups (#4394)', () => {
  it('keeps Bookings → Locations visible after the Team group loads in', async () => {
    canAnswersLoaded.value = false
    const w = await mountSidebar()

    const before = w.element.querySelector(`a[href="/admin/${TEAM}/bookings/locations"]`)
    expect(before).not.toBeNull()
    expect(isFolded(before)).toBe(false)

    // Rights answers arrive → Team group appears above Bookings.
    canAnswersLoaded.value = true
    await nextTick()

    expect(w.element.querySelector(`a[href="/admin/${TEAM}/team"]`)).not.toBeNull()
    const after = w.element.querySelector(`a[href="/admin/${TEAM}/bookings/locations"]`)
    expect(after).not.toBeNull()
    expect(isFolded(after)).toBe(false)
  })

  it('opens the Team group once it loads in, like it did when it was always there', async () => {
    canAnswersLoaded.value = false
    const w = await mountSidebar()
    canAnswersLoaded.value = true
    await nextTick()

    const members = w.element.querySelector(`a[href="/admin/${TEAM}/team"]`)
    expect(isFolded(members)).toBe(false)
  })

  it('still folds a group that is not meant to start open, after Team loads in', async () => {
    canAnswersLoaded.value = false
    const w = await mountSidebar()
    canAnswersLoaded.value = true
    await nextTick()

    expect(isFolded(w.element.querySelector(`a[href="/admin/${TEAM}/crouton/mainItems"]`))).toBe(false)
    expect(isFolded(w.element.querySelector(`a[href="/admin/${TEAM}/crouton/images"]`))).toBe(true)
  })
})
