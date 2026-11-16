<script setup lang="ts">
/**
 * CroutonBookingsLayoutFilters — the filter controls as an atomic layout block
 * (#924). Reads/writes the shared filter store (`useBookingsLayoutFilters`), so
 * it drives the sibling list / calendar / locations blocks across panes.
 *
 * Panel-only view controls (calendar view, Today, fold, map, location cards) are
 * hidden with `view-toggles=false`. On a composed page the layout decides what shows.
 */
const props = withDefaults(defineProps<{
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })

const { locations } = useBookingsList({ scope: props.scope })
const { filters } = useBookingsLayoutFilters()
const { open: openCroutonForm } = useCrouton()
const { isAdmin } = useTeam()

function onAddLocation() {
  openCroutonForm('create', 'bookingsLocations', [], 'slideover')
}
function onEditLocation(loc: { id: string }) {
  openCroutonForm('update', 'bookingsLocations', [loc.id], 'slideover')
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsPanelFilters
      :locations="locations ?? []"
      :selected-locations="filters.locations"
      :show-cancelled="filters.showCancelled"
      :can-manage-locations="isAdmin"
      :view-toggles="false"
      @update:selected-locations="filters.locations = $event"
      @update:show-cancelled="filters.showCancelled = $event"
      @add-location="onAddLocation"
      @edit-location="onEditLocation"
    />
  </div>
</template>
