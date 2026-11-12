import type { Booking, LocationData, SettingsData } from '../types/booking'

/**
 * Composable for fetching and managing bookings list
 * Uses the customer-bookings or admin-bookings API endpoint based on scope
 */
export function useBookingsList(options?: { scope?: 'personal' | 'team' }) {
  const { currentTeam } = useTeam()
  const scope = options?.scope ?? 'personal'

  // Choose endpoint based on scope: personal = only my bookings, team = all team bookings
  const bookingsEndpoint = scope === 'team' ? 'admin-bookings' : 'customer-bookings'

  // Fetch bookings (client-only, depends on auth context)
  // Use same key as useBookingCart to share cache (scope-specific). Every key carries the
  // team id, so the team arriving after mount re-runs the fetch (#3751) — a fixed key
  // turns off Nuxt's re-fetch on URL change.
  // dedupe: 'defer' — several blocks own the same key, and EACH owner re-runs it when the
  // key changes; with Nuxt's default 'cancel' every owner aborts the one before it, so the
  // blocks page sent ~a dozen cancelled requests per load (#3789). 'defer' joins the
  // request already running. Manual refresh() below forces fresh data with 'cancel'.
  const {
    data: bookingsData,
    pending: bookingsLoading,
    error: bookingsError,
    refresh: refreshBookings,
  } = useFetch<Booking[]>(
    () => currentTeam.value?.id
      ? `/api/crouton-bookings/teams/${currentTeam.value.id}/${bookingsEndpoint}`
      : null as any,
    {
      key: () => `crouton-booking-sidebar-${bookingsEndpoint}-${currentTeam.value?.id ?? 'none'}`,
      dedupe: 'defer',
      default: () => [],
      server: false, // Avoid SSR hydration mismatch - team context is client-side
    },
  )

  // Fetch settings (client-only, depends on auth context)
  const {
    data: settingsData,
    pending: settingsLoading,
    error: settingsError,
    refresh: refreshSettings,
  } = useFetch<SettingsData[]>(
    () => currentTeam.value?.id
      ? `/api/teams/${currentTeam.value.id}/bookings-settings`
      : null as any,
    {
      key: () => `crouton-booking-list-settings-${scope}-${currentTeam.value?.id ?? 'none'}`,
      dedupe: 'defer',
      default: () => [],
      server: false, // Avoid SSR hydration mismatch - team context is client-side
    },
  )

  // Fetch locations (for calendar indicators and filters)
  const {
    data: locationsData,
    pending: locationsLoading,
    error: locationsError,
    refresh: refreshLocations,
  } = useFetch<LocationData[]>(
    () => currentTeam.value?.id
      ? `/api/crouton-bookings/teams/${currentTeam.value.id}/customer-locations`
      : null as any,
    {
      key: () => `crouton-booking-list-locations-${scope}-${currentTeam.value?.id ?? 'none'}`,
      dedupe: 'defer',
      default: () => [],
      server: false, // Avoid SSR hydration mismatch - team context is client-side
    },
  )

  // When in personal scope, also fetch all team bookings for calendar indicators.
  // This ensures the calendar shows slots taken by other users so you can't book over them.
  let calendarBookingsData = ref<Booking[]>([])
  let refreshCalendarBookings = async () => {}

  if (scope === 'personal') {
    const { data, refresh: refreshAll } = useFetch<Booking[]>(
      () => currentTeam.value?.id
        ? `/api/crouton-bookings/teams/${currentTeam.value.id}/calendar-bookings`
        : null as any,
      {
        key: () => `crouton-booking-calendar-all-${currentTeam.value?.id ?? 'none'}`,
        dedupe: 'defer',
        default: () => [],
        server: false,
      },
    )
    calendarBookingsData = data as any
    refreshCalendarBookings = () => refreshAll({ dedupe: 'cancel' })
  }

  // Combined loading state (also loading if team not ready yet)
  const loading = computed(() => !currentTeam.value?.id || bookingsLoading.value || settingsLoading.value || locationsLoading.value)

  // Combined error state (only show errors if team is ready)
  const error = computed(() => currentTeam.value?.id ? (bookingsError.value || settingsError.value || locationsError.value) : null)

  // Get first settings record (there should only be one per team)
  const settings = computed<SettingsData | null>(() => {
    return (settingsData.value as any)?.[0] || null
  })

  // Locations list
  const locations = computed<LocationData[]>(() => {
    return (locationsData.value as LocationData[]) || []
  })

  // Sort bookings by date (ascending)
  const bookings = computed<Booking[]>(() => {
    if (!bookingsData.value) return []
    return [...(bookingsData.value as Booking[])].sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateA - dateB
    })
  })

  // Calendar bookings for indicators — all team bookings in personal scope, otherwise same as bookings
  const calendarBookings = computed<Booking[]>(() => {
    if (scope === 'personal' && calendarBookingsData.value.length > 0) {
      return [...calendarBookingsData.value].sort((a, b) => {
        const dateA = new Date(a.date).getTime()
        const dateB = new Date(b.date).getTime()
        return dateA - dateB
      })
    }
    return bookings.value
  })

  // Refresh all data — an explicit refresh (e.g. after a save) must get fresh data, so it
  // cancels any request in flight instead of joining it (the fetches default to 'defer', #3789).
  async function refresh() {
    const fresh = { dedupe: 'cancel' } as const
    await Promise.all([refreshBookings(fresh), refreshSettings(fresh), refreshLocations(fresh), refreshCalendarBookings()])
  }

  return {
    bookings,
    calendarBookings,
    settings,
    locations,
    loading,
    error,
    refresh,
  }
}
