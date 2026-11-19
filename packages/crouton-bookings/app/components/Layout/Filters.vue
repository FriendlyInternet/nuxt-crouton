<script setup lang="ts">
/**
 * CroutonBookingsLayoutFilters — the filter controls as an atomic layout block
 * (#924), fed by the `bookings` layout store (#3651).
 *
 * Props in, events out: it reads `filters` and emits `update:filters` with the
 * new state; adding/editing a location is handled by the store.
 *
 * Panel-only view controls (calendar view, Today, fold, map, location cards) are
 * hidden with `view-toggles=false`. On a composed page the layout decides what shows.
 */
import type { LocationData } from '../../types/booking'
import type { BookingsFilterState } from '../../composables/useBookingsStore'

const props = withDefaults(defineProps<{
  filters?: BookingsFilterState
  locations?: LocationData[]
  canManageLocations?: boolean
}>(), {
  filters: () => ({ statuses: [], locations: [], showCancelled: false }),
  locations: () => [],
  canManageLocations: false,
})

const emit = defineEmits<{
  'update:filters': [filters: BookingsFilterState]
  'add-location': []
  'edit-location': [location: LocationData]
}>()

function onLocations(locations: string[]) {
  emit('update:filters', { ...props.filters, locations })
}
function onShowCancelled(showCancelled: boolean) {
  emit('update:filters', { ...props.filters, showCancelled })
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsPanelFilters
      :locations="locations"
      :selected-locations="filters.locations"
      :show-cancelled="filters.showCancelled"
      :can-manage-locations="canManageLocations"
      :view-toggles="false"
      @update:selected-locations="onLocations"
      @update:show-cancelled="onShowCancelled"
      @add-location="emit('add-location')"
      @edit-location="emit('edit-location', $event)"
    />
  </div>
</template>
