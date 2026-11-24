import type { Booking } from '../types/booking'
import { pickOne } from '../utils/location-tabs'

export interface BookingsLayoutFilterState {
  statuses: string[]
  locations: string[]
  showCancelled: boolean
}

/**
 * Shared filter state for the bookings LAYOUT BLOCKS (#924).
 *
 * The native `CroutonBookingsPanel` owns its filter state and prop-drills it to
 * its Calendar / List / Map / Filters children. When those surfaces are pulled
 * apart into separate layout-engine panes, the layout tree gives them no channel
 * to share that state — so this `useState`-backed store is the out-of-band wire
 * that lets the `bookings-filters` block drive the `bookings-list` /
 * `bookings-calendar-only` / `bookings-locations` blocks.
 *
 * This is gap #1 in the #924 report: cross-pane coordination can't be expressed
 * by the (data-only) layout tree; it needs a shared composable the blocks agree
 * on. `useState` (SSR-safe, request-scoped) is the lightest such channel.
 */
export function useBookingsLayoutFilters() {
  const filters = useState<BookingsLayoutFilterState>(
    'bookings-layout-filters',
    () => ({ statuses: [], locations: [], showCancelled: false }),
  )

  const hasActiveFilters = computed(() =>
    filters.value.statuses.length > 0
    || filters.value.locations.length > 0
    || filters.value.showCancelled,
  )

  // One location or none (#4471) — the same rule as the location tab row
  function toggleLocation(locationId: string) {
    filters.value.locations = pickOne(filters.value.locations, locationId)
  }

  /** Apply the shared filter to a bookings array — mirrors Panel's `filteredBookings`. */
  function applyFilters(bookings: Booking[]): Booking[] {
    let result = bookings
    if (!filters.value.showCancelled) {
      result = result.filter(b => b.status !== 'cancelled')
    }
    if (filters.value.statuses.length > 0) {
      result = result.filter(b => filters.value.statuses.includes(b.status))
    }
    if (filters.value.locations.length > 0) {
      result = result.filter(b => filters.value.locations.includes((b as { location?: string }).location ?? ''))
    }
    return result
  }

  return { filters, hasActiveFilters, toggleLocation, applyFilters }
}
