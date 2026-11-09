import { createBookingsStore, getOrCreateStore, useBookingsStore, type BookingsStore } from './useBookingsStore'

/**
 * The store a bookings LAYOUT BLOCK reads (#2561). Replaces the old
 * `useBookingsLayoutFilters` (a second, app-global copy of the filters).
 *
 * Blocks hold no state of their own: they take the screen's store from above
 * (a Panel or a page scope that provided one). With nothing above them, sibling
 * blocks on a composed page share one store per app instance and data scope.
 */
export function useBookingsLayoutStore(scope: 'personal' | 'team' = 'team'): BookingsStore {
  const provided = useBookingsStore()
  if (provided) return provided

  const nuxtApp = useNuxtApp() as unknown as { _croutonBookingsStores?: Record<string, BookingsStore> }
  const holder = nuxtApp._croutonBookingsStores ??= {}
  return getOrCreateStore(holder, scope, () => {
    const { bookings, calendarBookings, locations } = useBookingsList({ scope })
    return createBookingsStore({
      bookings: bookings as any,
      calendarBookings: calendarBookings as any,
      locations: locations as any,
      readOnly: ref(false),
    })
  })
}
