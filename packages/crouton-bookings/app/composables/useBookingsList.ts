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
  // Use same key as useBookingCart to share cache (scope-specific)
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
      key: `crouton-booking-sidebar-${bookingsEndpoint}`,
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
      key: `crouton-booking-list-settings-${scope}`,
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
      key: `crouton-booking-list-locations-${scope}`,
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
        key: 'crouton-booking-calendar-all',
        default: () => [],
        server: false,
      },
    )
    calendarBookingsData = data as any
    refreshCalendarBookings = refreshAll
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

  // Refresh all data
  async function refresh() {
    await Promise.all([refreshBookings(), refreshSettings(), refreshLocations(), refreshCalendarBookings()])
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
