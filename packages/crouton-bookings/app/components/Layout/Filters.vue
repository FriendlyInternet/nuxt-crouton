<script setup lang="ts">
/**
 * CroutonBookingsLayoutFilters — the filter controls as an atomic layout block
 * (#924). Reads/writes the shared filter store (`useBookingsLayoutStore`), so
 * it drives the sibling list / calendar / locations blocks across panes.
 *
 * Gap-report note (#924): `CroutonBookingsPanelFilters` also emits Panel-VIEW
 * toggles (show calendar / map / locations, go-to-today, calendar-view). Those
 * are meaningful only inside the single compound Panel — across separate panes a
 * "show the calendar" toggle has nothing to toggle. They're kept as local refs
 * (inert) so the control renders unchanged; only the data filters (locations,
 * showCancelled) are wired to the shared store. This is gap #2: view-state emits
 * assume one owning surface, not independent panes.
 */
const props = withDefaults(defineProps<{
  scope?: 'personal' | 'team'
}>(), { scope: 'team' })

const { locations } = useBookingsList({ scope: props.scope })
const { filters } = useBookingsLayoutStore(props.scope)
const { open: openCroutonForm } = useCrouton()
const { isAdmin } = useTeam()

// Panel-view toggles — inert across panes (see gap note above), kept local.
const showLocations = ref(false)
const showMap = ref(false)
const showCalendar = ref(true)
const calendarView = ref<'week' | 'month'>('month')

const hasLocationsWithCoordinates = computed(() => (locations.value ?? []).length > 0)

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
      :show-locations="showLocations"
      :show-map="showMap"
      :show-calendar="showCalendar"
      :show-cancelled="filters.showCancelled"
      :has-locations-with-coordinates="hasLocationsWithCoordinates"
      :can-manage-locations="isAdmin"
      :calendar-view="calendarView"
      @update:selected-locations="filters.locations = $event"
      @update:show-locations="showLocations = $event"
      @update:show-map="showMap = $event"
      @update:show-calendar="showCalendar = $event"
      @update:show-cancelled="filters.showCancelled = $event"
      @update:calendar-view="calendarView = $event"
      @add-location="onAddLocation"
      @edit-location="onEditLocation"
    />
  </div>
</template>
