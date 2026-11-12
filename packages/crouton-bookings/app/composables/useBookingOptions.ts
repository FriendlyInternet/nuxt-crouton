/**
 * useBookingOptions - Composable for fetching and looking up booking option labels
 *
 * Provides translated labels for user-defined options like statuses and groups.
 * Fetches settings once and caches them for lookup.
 */

interface OptionItem {
  id: string
  label: string
  value: string
  translations?: {
    label?: Record<string, string>
  }
}

export function useBookingOptions() {
  const { locale } = useI18n()
  const { currentTeam } = useTeam()

  // Fetch settings collection using team-scoped endpoint
  // dedupe: 'defer' — one card per booking owns this key; with Nuxt's default 'cancel'
  // each owner aborts the others' request when the team arrives (#3789).
  const { data: settingsData, pending, error, refresh: refreshSettings } = useFetch(
    () => currentTeam.value?.id ? `/api/teams/${currentTeam.value.id}/bookings-settings` : null as any,
    {
      key: () => `crouton-booking-options-settings-${currentTeam.value?.id ?? 'none'}`,
      dedupe: 'defer',
      default: () => [],
      server: false, // Avoid SSR hydration mismatch - team context is client-side
    }
  )

  // An explicit refresh must get fresh data, so it cancels a request in flight (#3789).
  const refresh = () => refreshSettings({ dedupe: 'cancel' })

  // Extract statuses from settings (already parsed by jsonColumn in schema)
  const statuses = computed<OptionItem[]>(() => {
    const settings = (settingsData.value as any)?.[0]
    return Array.isArray(settings?.statuses) ? settings.statuses : []
  })

  // Extract groups from settings (already parsed by jsonColumn in schema)
  const groups = computed<OptionItem[]>(() => {
    const settings = (settingsData.value as any)?.[0]
    return Array.isArray(settings?.groups) ? settings.groups : []
  })

  /**
   * Get translated label for an option
   */
  function getTranslatedLabel(item: OptionItem | undefined): string {
    if (!item) return ''

    // Check for translation in current locale
    const translation = item.translations?.label?.[locale.value]
    if (translation) {
      return translation
    }

    // Fallback to default label
    return item.label || item.value || ''
  }

  /**
   * Look up status label by value
   */
  function getStatusLabel(statusValue: string): string {
    if (!statusValue) return ''

    const status = statuses.value.find(s => s.value === statusValue)
    if (status) {
      return getTranslatedLabel(status)
    }

    // Fallback to capitalizing the value
    return statusValue.charAt(0).toUpperCase() + statusValue.slice(1)
  }

  /**
   * Look up group label by ID
   * Note: Bookings store the group's ID, not value
   */
  function getGroupLabel(groupId: string): string {
    if (!groupId) return ''

    const group = groups.value.find(g => g.id === groupId)
    if (group) {
      return getTranslatedLabel(group)
    }

    // Fallback to the raw ID (shouldn't normally happen)
    return groupId
  }

  return {
    statuses,
    groups,
    pending,
    error,
    refresh,
    getStatusLabel,
    getGroupLabel,
    getTranslatedLabel
  }
}
