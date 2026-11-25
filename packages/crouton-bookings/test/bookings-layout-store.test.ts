/**
 * #3651 — the `bookings` layout store: one copy per source, scope comes from the
 * source's options, and the feeds map the store to the List / Filters /
 * Locations blocks. `useBookingsList` is mocked (it needs Nuxt's useFetch);
 * `useNotify` / `useT` / `useTeam` / `useCan` / `useCrouton` / `useBookingCart` are Nuxt
 * auto-imports, stubbed on globalThis as in `team-keyed-fetch.test.ts`. The
 * real `createBookingsStore` runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computed, effectScope, ref } from 'vue'
import { bookingsLayoutStore, type BookingsLayoutStore } from '../app/utils/bookings-layout-store'

const listCalls: Array<{ scope?: string }> = []
let refresh = vi.fn(async () => {})
const bookingsData = ref<any[]>([])
const locationsData = ref<any[]>([])

vi.mock('../app/composables/useBookingsList', () => ({
  useBookingsList: (opts: { scope?: string } = {}) => {
    listCalls.push(opts)
    const bookings = computed(() => bookingsData.value)
    return {
      bookings,
      calendarBookings: bookings,
      locations: computed(() => locationsData.value),
      settings: computed(() => null),
      loading: computed(() => false),
      error: computed(() => null),
      refresh,
    }
  },
}))

const lastBookingCreatedAt = ref(0)
const opened: unknown[][] = []
const warnings: string[] = []

beforeEach(() => {
  listCalls.length = 0
  opened.length = 0
  warnings.length = 0
  refresh = vi.fn(async () => {})
  bookingsData.value = [
    { id: 'b1', date: '2026-11-20', status: 'confirmed', location: 'a' },
    { id: 'b2', date: '2026-11-21', status: 'cancelled', location: 'b' },
  ]
  locationsData.value = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  const g = globalThis as any
  g.useNotify = () => ({ warning: (m: string) => warnings.push(m) })
  g.useT = () => ({ t: (k: string) => k })
  g.useTeam = () => ({ isAdmin: ref(true) })
  g.useCan = () => ref(true) // #4105 — `bookings:manage` permission
  g.useCrouton = () => ({ open: (...args: unknown[]) => opened.push(args) })
  g.useBookingCart = () => ({ lastBookingCreatedAt })
})

/** One copy, created the way the scope does it (inside a setup-like effect scope). */
function copy(source: string, options: Record<string, unknown> = {}): BookingsLayoutStore {
  let s!: BookingsLayoutStore
  effectScope().run(() => {
    s = bookingsLayoutStore.setup({ key: `layout-store:t:${source}`, source, options })
  })
  return s
}

const feed = (block: string) => bookingsLayoutStore.feeds[block]!
const props = (block: string, s: BookingsLayoutStore) => feed(block).props!(s)
const fire = (block: string, event: string, s: BookingsLayoutStore, ...args: unknown[]) => feed(block).events![event]!(s, ...args)

describe('bookings layout store (#3651)', () => {
  // covers: T2
  it('two copies (two composed layouts) never share filter state', () => {
    const one = copy('bookings')
    const two = copy('bookings')
    fire('bookings-locations', 'toggle-location', one, 'a')
    expect(one.filters.value.locations).toEqual(['a'])
    expect(two.filters.value.locations).toEqual([])
    fire('bookings-filters', 'update:filters', one, { statuses: [], locations: ['a'], showCancelled: true })
    expect(one.filters.value.showCancelled).toBe(true)
    expect(two.filters.value).toEqual({ statuses: [], locations: [], showCancelled: false })
  })

  // covers: T3
  it('loads with the source\'s scope: `bookings` → team, `bookings#mine` { scope: personal } → personal', () => {
    const team = copy('bookings')
    const mine = copy('bookings#mine', { scope: 'personal' })
    expect(listCalls).toEqual([{ scope: 'team' }, { scope: 'personal' }])
    expect(team.scope).toBe('team')
    expect(mine.scope).toBe('personal')
  })

  // covers: T4
  it('the list feed maps the shared interaction state onto the block props', () => {
    const s = copy('bookings')
    const day = new Date(2026, 10, 20)
    s.hover('b1')
    s.selectDay(day)
    const p = props('bookings-list', s)
    expect(p.highlightedBookingId).toBe('b1')
    expect(p.selectedDate).toBe(day)
    expect(p.scrollTarget).toEqual(day)
    expect(p.creatingAt).toBeNull()
    expect(p.loading).toBe(false)
    expect(p.error).toBeNull()
    expect(p.isDayFullyBooked).toBe(s.isFullyBooked)
    // Cancelled bookings are hidden until "show cancelled" is on.
    expect((p.bookings as any[]).map(b => b.id)).toEqual(['b1'])
  })

  // covers: T4
  it('active filters with no matching bookings give the "no matches" state', () => {
    const s = copy('bookings')
    locationsData.value = [...locationsData.value, { id: 'c', title: 'C' }]
    fire('bookings-locations', 'toggle-location', s, 'c')
    const p = props('bookings-list', s)
    expect(p.bookings).toEqual([])
    expect(p.hasActiveFilters).toBe(true)
    expect(p.activeLocationFilter).toEqual(['c'])
  })

  // covers: T4
  it('list events: dateClick selects the day, newBooking starts create, created finishes with reload, cancel clears', async () => {
    const s = copy('bookings')
    const day = new Date(2026, 10, 20)
    fire('bookings-list', 'dateClick', s, day)
    expect(s.selectedDate.value).toBe(day)

    fire('bookings-list', 'newBooking', s, day)
    expect(s.creatingAt.value).toBe(day)
    expect(props('bookings-list', s).creatingAt).toBe(day)

    fire('bookings-list', 'created', s)
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(s.creatingAt.value).toBeNull()

    fire('bookings-list', 'newBooking', s, day)
    fire('bookings-list', 'cancel', s)
    expect(s.creatingAt.value).toBeNull()
  })

  // covers: T4
  it('newBooking with no locations warns instead of opening the form', () => {
    locationsData.value = []
    const s = copy('bookings')
    fire('bookings-list', 'newBooking', s, new Date(2026, 10, 20))
    expect(s.creatingAt.value).toBeNull()
    expect(warnings).toEqual(['bookings.notifications.noLocations'])
  })

  // covers: T4
  it('filters feed: props in, update:filters replaces the filters, location add/edit open the form', () => {
    const s = copy('bookings')
    expect(props('bookings-filters', s)).toEqual({
      filters: { statuses: [], locations: [], showCancelled: false },
      locations: locationsData.value,
      canManageLocations: true,
    })
    fire('bookings-filters', 'update:filters', s, { statuses: [], locations: [], showCancelled: true })
    expect(s.filters.value.showCancelled).toBe(true)
    expect((props('bookings-list', s).bookings as any[]).map(b => b.id)).toEqual(['b1', 'b2'])
    fire('bookings-filters', 'add-location', s)
    fire('bookings-filters', 'edit-location', s, { id: 'a' })
    expect(opened).toEqual([
      ['create', 'bookingsLocations', [], 'slideover'],
      ['update', 'bookingsLocations', ['a'], 'slideover'],
    ])
  })

  // covers: T4
  it('locations feed: toggle-location toggles the location filter', () => {
    const s = copy('bookings')
    fire('bookings-locations', 'toggle-location', s, 'a')
    expect(props('bookings-locations', s).selectedLocations).toEqual(['a'])
    fire('bookings-locations', 'toggle-location', s, 'a')
    expect(props('bookings-locations', s).selectedLocations).toEqual([])
  })

  // covers: T5
  it('scope moved from the block to the source: only bookings-calendar-only keeps its scope option', async () => {
    // app.config calls the Nuxt auto-import `defineAppConfig` (identity at runtime).
    ;(globalThis as any).defineAppConfig = (c: unknown) => c
    const blocks = (await import('../app/app.config')).default.croutonLayoutBlocks as any
    expect(blocks['bookings-list'].configSchema).toBeUndefined()
    expect(blocks['bookings-filters'].configSchema).toBeUndefined()
    expect(blocks['bookings-locations'].configSchema).toBeUndefined()
    expect(blocks['bookings-calendar-only'].configSchema.map((f: any) => f.name)).toEqual(['scope'])
  })
})
