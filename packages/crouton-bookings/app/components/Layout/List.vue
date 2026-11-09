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

// useBookingsList fetches client-only (`server: false`): on the server `loading` is
// false (empty state drawn) but on the client it flips to true during hydration
// (skeleton) — a hydration mismatch. Show the skeleton until mounted so server and
// first client render agree.
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const showLoading = computed(() => !mounted.value || loading.value)
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsList
      :bookings="filteredBookings"
      :loading="showLoading"
      :error="error"
      :has-active-filters="hasActiveFilters"
      :active-location-filter="filters.locations"
    />
  </div>
</template>
