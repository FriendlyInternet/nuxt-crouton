<script setup lang="ts">
/**
 * CroutonBookingsLayoutList — the bookings LIST as a placeable, atomic layout
 * block (#924). Self-fetches team bookings via `useBookingsList` (shared
 * `useFetch` cache key ⇒ no duplicate network calls across blocks) and applies
 * the shared layout filter store, then renders `CroutonBookingsList`.
 *
 * Atomicity note (#924 gap report): the native Panel also feeds List a bundle of
 * interaction state (selected-date highlight, hovered-booking-id, creating-at-
 * date, scroll-target) driven by the sibling Calendar. Across separate panes the
 * layout tree can't carry that, so those cross-surface niceties are inert here —
 * the list still lists + filters, which is the block's atomic job.
 */
const props = withDefaults(defineProps<{
  /** 'personal' = my bookings, 'team' = all team bookings. */
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })

const { bookings, loading, error } = useBookingsList({ scope: props.scope })
const { applyFilters, hasActiveFilters, filters } = useBookingsLayoutFilters()

const filteredBookings = computed(() => applyFilters(bookings.value ?? []))
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsList
      :bookings="filteredBookings"
      :loading="loading"
      :error="error"
      :has-active-filters="hasActiveFilters"
      :active-location-filter="filters.locations"
    />
  </div>
</template>
