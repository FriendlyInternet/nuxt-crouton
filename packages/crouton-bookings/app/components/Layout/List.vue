<script setup lang="ts">
/**
 * CroutonBookingsLayoutList — the bookings LIST as a placeable, atomic layout
 * block (#924). Self-fetches team bookings via `useBookingsList` (shared
 * `useFetch` cache key ⇒ no duplicate network calls across blocks) and applies
 * the shared layout filter store, then renders `CroutonBookingsList`.
 *
 * Its interaction state (selected day, hovered booking, new-booking date, scroll
 * target) comes from the screen's bookings store (#2561), the same one the
 * calendar block drives.
 */
const props = withDefaults(defineProps<{
  /** 'personal' = my bookings, 'team' = all team bookings. */
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })

const { loading, error, refresh } = useBookingsList({ scope: props.scope })
const store = useBookingsLayoutStore(props.scope)
const { filters, filteredBookings, hasActiveFilters, selectedDate, hoveredBookingId, creatingAt, scrollTarget } = store

async function onCreated() {
  await store.finishCreate(refresh)
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsList
      :bookings="filteredBookings"
      :loading="loading"
      :error="error"
      :has-active-filters="hasActiveFilters"
      :active-location-filter="filters.locations"
      :selected-date="selectedDate"
      :highlighted-booking-id="hoveredBookingId"
      :creating-at-date="creatingAt"
      :scroll-target="scrollTarget"
      :is-day-fully-booked="store.isFullyBooked"
      @created="onCreated"
      @cancel-create="store.cancelCreate"
      @new-booking="store.startCreate"
      @top-visible-date-change="store.showPeriod"
      @date-click="store.selectDate"
    />
  </div>
</template>
