import { inject } from 'vue'
import { createBookingsStore, getOrCreateStore, useBookingsStore, type BookingsStore } from './useBookingsStore'

const layoutHolders = new WeakMap<object, Record<string, BookingsStore>>()

/**
 * The store a bookings LAYOUT BLOCK reads (#2561). Replaces the old
 * `useBookingsLayoutFilters` (a second, app-global copy of the filters).
 *
 * Blocks hold no state of their own: they take the screen's store from above
 * (a Panel or a page scope that provided one). With nothing above them, blocks of one layout share a store per data scope; two layouts share nothing.
 */
export function useBookingsLayoutStore(scope: 'personal' | 'team' = 'team'): BookingsStore {
  const provided = useBookingsStore()
  if (provided) return provided

  // One store per LAYOUT INSTANCE (provided by the layout renderer): blocks of one
  // layout share it, two layouts on a page share nothing. Outside any layout, fall
  // back to one per app instance.
  const layout = inject<object | null>('croutonLayoutInstance', null)
  let holder: Record<string, BookingsStore>
  if (layout) {
    holder = layoutHolders.get(layout) ?? {}
    layoutHolders.set(layout, holder)
  }
  else {
    const nuxtApp = useNuxtApp() as unknown as { _croutonBookingsStores?: Record<string, BookingsStore> }
    holder = nuxtApp._croutonBookingsStores ??= {}
  }
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
