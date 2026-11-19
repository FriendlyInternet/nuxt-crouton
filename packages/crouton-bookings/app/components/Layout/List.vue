<script setup lang="ts">
/**
 * CroutonBookingsLayoutList — the bookings LIST as a placeable, atomic layout
 * block (#924), fed by the `bookings` layout store (#3651).
 *
 * Props in, events out: it loads nothing itself. The store hands it the filtered
 * bookings plus the shared interaction state (selected day, hovered booking,
 * scroll target, the new-booking date) and handles its events. Without props it
 * renders an empty list.
 */
import { ref } from 'vue'
import type { Booking } from '../../types/booking'

withDefaults(defineProps<{
  bookings?: Booking[]
  loading?: boolean
  error?: unknown
  highlightedBookingId?: string | null
  selectedDate?: Date | null
  scrollTarget?: Date | null
  hasActiveFilters?: boolean
  activeLocationFilter?: string[]
  creatingAt?: Date | null
  isDayFullyBooked?: (date: Date) => boolean
}>(), {
  bookings: () => [],
  loading: false,
  error: null,
  highlightedBookingId: null,
  selectedDate: null,
  scrollTarget: null,
  hasActiveFilters: false,
  activeLocationFilter: () => [],
  creatingAt: null,
  isDayFullyBooked: undefined,
})

const emit = defineEmits<{
  dateClick: [date: Date]
  newBooking: [date: Date]
  created: []
  cancel: []
}>()

const scrollEl = ref<HTMLElement | null>(null)
</script>

<template>
  <div ref="scrollEl" class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsList
      :bookings="bookings"
      :loading="loading"
      :error="(error as Error | null)"
      :has-active-filters="hasActiveFilters"
      :active-location-filter="activeLocationFilter"
      :selected-date="selectedDate"
      :highlighted-booking-id="highlightedBookingId"
      :scroll-target="scrollTarget"
      :creating-at-date="creatingAt"
      :is-day-fully-booked="isDayFullyBooked"
      :scroll-root="scrollEl"
      @date-click="emit('dateClick', $event)"
      @new-booking="emit('newBooking', $event)"
      @created="emit('created')"
      @cancel-create="emit('cancel')"
    />
  </div>
</template>
