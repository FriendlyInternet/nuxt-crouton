<script setup lang="ts">
/**
 * CroutonBookingsLayoutCalendarOnly — JUST the calendar as an atomic layout
 * block (#924), distinct from `bookings-calendar` (which wraps the whole Panel).
 * Self-fetches via `useBookingsList` and binds the shared layout filter store, so
 * the `bookings-filters` block drives which locations/statuses the calendar
 * reflects (Calendar filters its own indicators from the `filters` prop).
 *
 * Selecting a day, hovering a booking and the + button go through the screen's
 * store (#2561), so the sibling list block reacts.
 */
const props = withDefaults(defineProps<{
  scope?: 'personal' | 'team'
  /** Initial calendar view. */
  view?: 'week' | 'month'
}>(), { scope: 'team', view: 'month' })

const { calendarBookings, locations, settings } = useBookingsList({ scope: props.scope })
const store = useBookingsLayoutStore(props.scope)
const { filters, shownDate, selectedDate, creatingAt } = store

const view = ref<'week' | 'month'>(props.view)

function onDayClick(date: Date) {
  store.startCreate(date)
}
</script>

<template>
  <div class="@container h-full overflow-auto p-2 @md:p-3">
    <CroutonBookingsCalendar
      v-model:filters="filters"
      v-model:date="shownDate"
      :bookings="calendarBookings ?? []"
      :locations="locations ?? []"
      :settings="settings ?? null"
      :view="view"
      :selected-date="selectedDate"
      :creating-at-date="creatingAt"
      :is-date-unavailable="date => store.closedReason(date) !== null"
      @select="date => date && store.selectDay(date)"
      @day-click="onDayClick"
      @hover-booking="store.hover"
    />
  </div>
</template>
