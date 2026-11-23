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
 * `UNavigationMenu` is replaced by a stub that copies those Nuxt UI rules
 * (`getItemValue` / `getAccordionDefaultValue` in @nuxt/ui 4.x
 * NavigationMenu.vue, and a `modelValue` that, when given, decides the open
 * groups instead): the real component needs the Nuxt runtime, which this
 * suite does not boot. The e2e surface check runs the real one.
 */
import { describe, it, expect } from 'vitest'
import { ref, computed, shallowRef, onMounted, watch, nextTick, defineComponent, h, type PropType } from 'vue'
import { mount, renderToString } from '@vue/test-utils'
import { teamAdminPages, toSidebarItems } from '../../../crouton-admin/app/utils/team-pages'

const TEAM = 'e2e-team'
const canAnswersLoaded = ref(false)
const bookingsRegistered = ref(true)

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
  ref, computed, shallowRef, onMounted, watch,
  resolveComponent: (name: string) => name,
  useT: () => ({ t: (k: string) => k }),
  useRoute: () => ({ path: `/admin/${TEAM}/bookings` }),
  useTeamContext: () => ({ teamSlug: ref(TEAM), teamId: ref('t1'), hasTeamContext: ref(true) }),
  useCroutonApps: () => ({
    topLevelApps: computed(() => bookingsRegistered.value ? [bookingsApp] : []),
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
  props: {
    items: { type: Array as PropType<Item[]>, default: () => [] },
    modelValue: { type: Array as PropType<string[]>, default: undefined }
  },
  setup(props) {
    const valueOf = (item: Item, index: number) => item.value ?? `item-${index}`
    // Read once at mount, like Nuxt UI; only used when no modelValue is given.
    const defaultOpen = props.items.reduce<string[]>((acc, item, index) => {
      if (item.defaultOpen) acc.push(valueOf(item, index))
      return acc
    }, [])
    return () => {
      const open = props.modelValue ?? defaultOpen
      return h('ul', props.items.map((item, index) => h('li', [
        item.to ? h('a', { href: item.to }, item.label) : h('span', item.label),
        item.children?.length
          ? h('ul', { hidden: !open.includes(valueOf(item, index)) }, item.children.map(child => h('li', [h('a', { href: child.to }, child.label)])))
          : null
      ])))
    }
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

  it('draws the same menu on the server as on the first browser render, then adds Team', async () => {
    // The server already knows the member's rights; the browser's first render
    // may not. Team drawn on the server only made the two disagree and left
    // Bookings folded (seen in the with-bookings e2e trace).
    canAnswersLoaded.value = true
    bookingsRegistered.value = true
    const AdminSidebar = (await import('../../app/components/AdminSidebar.vue')).default
    const html = await renderToString(AdminSidebar, { global: { stubs } })
    expect(html).not.toContain(`/admin/${TEAM}/team"`)
    expect(html).toContain(`/admin/${TEAM}/bookings/locations`)

    const w = await mountSidebar()
    await nextTick()
    const members = w.element.querySelector(`a[href="/admin/${TEAM}/team"]`)
    expect(members).not.toBeNull()
    expect(isFolded(members)).toBe(false)
    expect(isFolded(w.element.querySelector(`a[href="/admin/${TEAM}/bookings/locations"]`))).toBe(false)
  })

  it('opens Bookings when it only shows up after the menu is already on screen', async () => {
    canAnswersLoaded.value = true
    bookingsRegistered.value = false
    const w = await mountSidebar()
    expect(w.element.querySelector(`a[href="/admin/${TEAM}/bookings/locations"]`)).toBeNull()

    bookingsRegistered.value = true
    await nextTick()

    const link = w.element.querySelector(`a[href="/admin/${TEAM}/bookings/locations"]`)
    expect(link).not.toBeNull()
    expect(isFolded(link)).toBe(false)
  })
})
