/**
 * The `bookings` layout store (#3651) — what a composed bookings page's blocks are
 * fed from. Registered by `plugins/layout-stores.ts`.
 *
 * One copy per source a layout names: `bookings` (the team's bookings) or e.g.
 * `bookings#mine` with `{ scope: 'personal' }` in the layout's `sources` map.
 * Scope is the SOURCE's option, not a per-block setting. `setup` runs once per
 * copy inside the layout store scope's own setup, so the data loads once and is
 * owned by a component that does not remount when panes stack.
 *
 * The blocks (`Layout/List.vue`, `Layout/Filters.vue`, `Layout/Locations.vue`)
 * take props and emit events; the feeds below map this store to them.
 */
import { inject, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { CroutonLayoutStoreDefinition } from '@fyit/crouton-core/app/types/layout'
import type { Booking, LocationData } from '../types/booking'
import { createBookingsStore, type BookingsFilterState, type BookingsStore } from '../composables/useBookingsStore'
import { useBookingsList } from '../composables/useBookingsList'

export interface BookingsLayoutStore extends BookingsStore {
  scope: 'team' | 'personal'
  bookings: ComputedRef<Booking[]>
  locations: ComputedRef<LocationData[]>
  loading: ComputedRef<boolean> | Ref<boolean>
  error: ComputedRef<unknown> | Ref<unknown>
  reload: () => Promise<unknown>
  /** The list's "+ New booking" row was tapped: start the create card (or say why not). */
  newBooking: (date: Date) => void
  canManageLocations: Ref<boolean> | ComputedRef<boolean>
  addLocation: () => void
  editLocation: (loc: { id: string }) => void
}

export const bookingsLayoutStore: CroutonLayoutStoreDefinition<BookingsLayoutStore> = {
  id: 'bookings',
  setup(ctx) {
    const scope = ctx.options.scope === 'personal' ? 'personal' : 'team'
    const list = useBookingsList({ scope })
    // Preview mode — injected by the admin page, the same way Panel gets it.
    // (`?? ref(false)`: `inject` gives undefined when there is no component, e.g. a unit test.)
    const readOnly = inject<Ref<boolean>>('bookings-preview-mode', ref(false)) ?? ref(false)
    const store = createBookingsStore({
      bookings: list.bookings,
      calendarBookings: list.calendarBookings,
      locations: list.locations,
      readOnly,
    })

    const notify = useNotify()
    const { t } = useT()
    // Managing locations is the `bookings:manage` site permission (#4105)
    const isAdmin = useCan('bookings:manage')
    const { open: openCroutonForm } = useCrouton()

    function newBooking(date: Date) {
      const result = store.startCreate(date)
      if (result === 'no-locations') {
        notify.warning(t('bookings.notifications.noLocations'), {
          description: t('bookings.notifications.noLocationsDescription'),
        })
      }
      else if (result === 'full') {
        notify.warning(t('bookings.notifications.allSlotsTaken'), {
          description: t('bookings.notifications.allSlotsTakenDescription'),
        })
      }
    }

    // Same safety net as Panel: the `created` event can be lost when the refresh
    // unmounts the create card mid-propagation, so the cart's signal also closes it.
    const { lastBookingCreatedAt } = useBookingCart()
    watch(lastBookingCreatedAt, (ts) => {
      if (ts && store.creatingAt.value) store.finishCreate(list.refresh)
    })

    return {
      ...store,
      scope,
      bookings: list.bookings,
      locations: list.locations,
      loading: list.loading,
      error: list.error,
      reload: list.refresh,
      newBooking,
      canManageLocations: isAdmin,
      addLocation: () => openCroutonForm('create', 'bookingsLocations', [], 'slideover'),
      editLocation: (loc: { id: string }) => openCroutonForm('update', 'bookingsLocations', [loc.id], 'slideover'),
    }
  },
  feeds: {
    'bookings-list': {
      props: s => ({
        bookings: s.filteredBookings.value,
        loading: s.loading.value,
        error: s.error.value,
        highlightedBookingId: s.hoveredBookingId.value,
        selectedDate: s.selectedDate.value,
        scrollTarget: s.scrollTarget.value,
        hasActiveFilters: s.hasActiveFilters.value,
        activeLocationFilter: s.filters.value.locations,
        creatingAt: s.creatingAt.value,
        isDayFullyBooked: s.isFullyBooked,
      }),
      events: {
        dateClick: (s, d: Date) => s.selectDay(d),
        newBooking: (s, d: Date) => s.newBooking(d),
        created: s => { s.finishCreate(s.reload) },
        cancel: s => s.cancelCreate(),
      },
    },
    'bookings-filters': {
      props: s => ({
        filters: s.filters.value,
        locations: s.locations.value,
        canManageLocations: s.canManageLocations.value,
      }),
      events: {
        'update:filters': (s, f: BookingsFilterState) => { s.filters.value = { ...f } },
        'add-location': s => s.addLocation(),
        'edit-location': (s, loc: { id: string }) => s.editLocation(loc),
      },
    },
    'bookings-locations': {
      props: s => ({
        locations: s.locations.value,
        selectedLocations: s.filters.value.locations,
      }),
      events: {
        'toggle-location': (s, id: string) => s.toggleLocation(id),
      },
    },
  },
}
