<script setup lang="ts">
import type { Booking, LocationData, SettingsData } from '../types/booking'

interface FilterState {
  statuses: string[]
  locations: string[]
  showCancelled: boolean
}

interface Props {
  /**
   * Bookings data. If not provided, will fetch using useBookingsList.
   * Provide this when you want to manage data externally.
   */
  bookings?: Booking[]
  /** Locations data. Required if bookings prop is provided. */
  locations?: LocationData[]
  /** Settings data. Required if bookings prop is provided. */
  settings?: SettingsData | null
  /** Loading state. Only used when bookings prop is provided. */
  loading?: boolean
  /** Error state. Only used when bookings prop is provided. */
  error?: Error | null
  /** Initial filter state */
  initialFilters?: Partial<FilterState>
  /** Title shown in the header. Set to empty string to hide header. */
  title?: string
  /** Empty state message when no bookings */
  emptyMessage?: string
  /** Booking scope: 'personal' shows only the user's bookings, 'team' shows all team bookings */
  scope?: 'personal' | 'team'
}

const props = withDefaults(defineProps<Props>(), {
  bookings: undefined,
  locations: undefined,
  settings: undefined,
  loading: false,
  error: undefined,
  initialFilters: () => ({}),
  title: undefined,
  emptyMessage: undefined,
  scope: 'personal',
})

const emit = defineEmits<{
  /** Emitted when a booking is created */
  created: []
  /** Emitted when a booking is updated */
  updated: []
  /** Emitted when an email is sent */
  emailSent: []
  /** Emitted when filters change */
  'update:filters': [filters: FilterState]
}>()

const { t } = useT()

// Resolved empty message with i18n default
const resolvedEmptyMessage = computed(() => props.emptyMessage ?? t('bookings.list.defaultEmptyMessage'))

// Determine if we're using internal data fetching
const useInternalData = props.bookings === undefined

// Internal data fetching (only used when bookings prop not provided)
const internalData = useInternalData ? useBookingsList({ scope: props.scope }) : null

// Resolved data - use props if provided, otherwise use internal data
const resolvedBookings = computed(() => {
  return props.bookings ?? internalData?.bookings.value ?? []
})

// Calendar bookings — all team bookings for accurate slot indicators (prevents booking over taken slots)
const resolvedCalendarBookings = computed(() => {
  return props.bookings ?? internalData?.calendarBookings.value ?? resolvedBookings.value
})

const resolvedLocations = computed(() => {
  return props.locations ?? internalData?.locations.value ?? []
})

const resolvedSettings = computed(() => {
  return props.settings ?? internalData?.settings.value ?? null
})

const resolvedLoading = computed(() => {
  if (useInternalData) {
    return internalData?.loading.value ?? false
  }
  return props.loading
})

const resolvedError = computed(() => {
  if (useInternalData) {
    return internalData?.error.value ?? null
  }
  return props.error ?? null
})

// Refresh function (only available with internal data)
async function refresh() {
  if (internalData) {
    await internalData.refresh()
  }
}

// Scroll container for map + list (also the list's observer root)
const scrollAreaRef = ref<HTMLElement | null>(null)

// Ref for PanelMap control (to fly to specific locations)
const panelMapRef = ref<{ flyToLocation: (locationId: string) => void } | null>(null)

// Crouton form and team auth for location creation
const { open: openCroutonForm } = useCrouton()
const { isAdmin } = useTeam()
const notify = useNotify()

// Preview mode - injected from admin page, defaults to false
const previewMode = inject<Ref<boolean>>('bookings-preview-mode', ref(false))

// This screen's shared state — filters, the selected day, hover, the new-booking
// date, the calendar's period and the list's scroll target (#2561). The bookings
// layout blocks will read the same store.
const store = provideBookingsStore({
  bookings: resolvedBookings,
  calendarBookings: resolvedCalendarBookings,
  locations: resolvedLocations,
  readOnly: previewMode,
  initialFilters: props.initialFilters,
})

// Closed days in the calendar: no location takes bookings that day.
function isDateUnavailableForAll(date: Date): boolean {
  return store.closedReason(date) !== null
}

function getBlockedReasonForAll(date: Date): string | null {
  const reason = store.closedReason(date)
  if (!reason) return null
  if (reason.kind === 'blocked') return reason.reason || t('bookings.calendar.blocked')
  return t('bookings.calendar.closed')
}

// Effective admin state - false when preview mode is active
const effectiveIsAdmin = computed(() => isAdmin.value && !previewMode.value)

// Handle add location - open crouton slideover
function onAddLocation() {
  openCroutonForm('create', 'bookingsLocations', [], 'slideover')
}

// Handle edit location - open crouton update slideover
function onEditLocation(location: LocationData) {
  openCroutonForm('update', 'bookingsLocations', [location.id], 'slideover')
}

// Pending flyTo location ID — used when map needs to initialize first
const pendingFlyToLocationId = ref<string | null>(null)

// Handle focus-on-map — show map if not visible, then fly to the location
async function onFocusOnMap(location: LocationData) {
  const coords = parseLocationCoordinates(location)
  if (!coords) return

  if (!showMap.value) {
    showMap.value = true
    pendingFlyToLocationId.value = location.id
    return
  }

  panelMapRef.value?.flyToLocation(location.id)
}

// Handle map ready — fly to pending location if any
function onMapReady() {
  if (pendingFlyToLocationId.value) {
    panelMapRef.value?.flyToLocation(pendingFlyToLocationId.value)
    pendingFlyToLocationId.value = null
  }
}

// Listen for location mutations to refresh the list
const nuxtApp = useNuxtApp()
nuxtApp.hook('crouton:mutation', async (event: { operation: string; collection: string }) => {
  if (event.collection === 'bookingsLocations' && (event.operation === 'create' || event.operation === 'update')) {
    await refresh()
  }
})

const selectedDate = store.selectedDate
const shownDate = store.shownDate
const scrollTarget = store.scrollTarget
const hoveredBookingId = store.hoveredBookingId
const filterState = store.filters

// Visibility states for panel sections
const showCalendar = ref(true)
const showLocations = ref(false)
const showMap = ref(false)

// Calendar view mode (lifted from Calendar component)
const calendarView = ref<'week' | 'month'>('week')

// Handle go-to-today from pill controls
const onGoToToday = store.goToToday

// Parse GeoJSON coordinates from location data
function parseLocationCoordinates(location: LocationData): [number, number] | null {
  if (!location.location) return null

  try {
    const geo = typeof location.location === 'string'
      ? JSON.parse(location.location)
      : location.location

    if (geo?.type === 'Point' && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
      return [geo.coordinates[0], geo.coordinates[1]]
    }

    if (Array.isArray(geo) && geo.length >= 2) {
      return [geo[0], geo[1]]
    }

    return null
  }
  catch {
    return null
  }
}

// Check if we have any locations with coordinates to show map toggle
const hasLocationsWithCoordinates = computed(() => {
  return resolvedLocations.value.some(location => parseLocationCoordinates(location) !== null)
})

// Toggle location filter (used by map marker clicks)
const toggleLocation = store.toggleLocation

// Emit filter changes
watch(filterState, (newFilters) => {
  emit('update:filters', { ...newFilters })
}, { deep: true })

// Inline creation state - date where we're creating a booking
const creatingAtDate = store.creatingAt

// Watch for booking creation signal from shared state.
// The emit('created') chain from BookingCreateCard → List → Panel can be lost
// when the async refreshMyBookings() unmounts the component mid-propagation.
const { lastBookingCreatedAt } = useBookingCart()
watch(lastBookingCreatedAt, (ts) => {
  if (ts && creatingAtDate.value) {
    onBookingCreated()
  }
})

const hasActiveFilters = store.hasActiveFilters
const filteredBookings = store.filteredBookings

// Select a day, show its period and scroll the list to it (a booking's date)
const selectDate = store.selectDate

// Handle calendar day select (the period is already visible)
function onCalendarSelect(date: Date | null) {
  if (date) store.selectDay(date)
}

// Calendar bookings give team-wide availability
const isDayFullyBookedAllLocations = store.isFullyBooked

// Handle calendar day click (+ button) - start inline creation at that date (disabled in preview mode)
function onCalendarDayClick(date: Date) {
  const result = store.startCreate(date)
  if (result === 'no-locations') {
    notify.warning(t('bookings.notifications.noLocations'), {
      description: t('bookings.notifications.noLocationsDescription'),
    })
  }
  else if (result === 'full') {
    notify.warning(t('bookings.notifications.allSlotsTaken'), {
      description: t('bookings.notifications.allSlotsTakenDescription'),
    })
  }
}

// Handle booking created - refresh all data (including calendar indicators), then scroll to its day
async function onBookingCreated() {
  const done = store.finishCreate(refresh)
  emit('created')
  await done
}

// Handle booking updated - refresh the list
async function onBookingUpdated() {
  await refresh()
  emit('updated')
}

// Handle email sent - refresh the list to update email stats
async function onEmailSent() {
  await refresh()
  emit('emailSent')
}

// Handle cancel creation
const onCancelCreate = store.cancelCreate

// Handle list scroll - sync calendar to top visible date (week changes)
const onTopVisibleDateChange = store.showPeriod

// Expose methods for external control
defineExpose({
  refresh,
})
</script>

<template>
  <div class="booking-panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-default bg-default">
      <!-- Fixed on top: filters + calendar. Only the list below scrolls. -->
      <div class="shrink-0 flex flex-col gap-2 border-b border-default">
        <!-- Filter controls -->
        <div class="px-2 pt-2 pb-1.5 md:px-4 md:pt-3 md:pb-2">
          <CroutonBookingsPanelFilters
            :locations="resolvedLocations"
            :selected-locations="filterState.locations"
            :has-selected-date="!!selectedDate"
            :show-locations="showLocations"
            :show-map="showMap"
            :show-calendar="showCalendar"
            :show-cancelled="filterState.showCancelled"
            :has-locations-with-coordinates="hasLocationsWithCoordinates"
            :can-manage-locations="effectiveIsAdmin"
            :calendar-view="calendarView"
            @update:selected-locations="filterState.locations = $event"
            @update:show-locations="showLocations = $event"
            @update:show-map="showMap = $event"
            @update:show-calendar="showCalendar = $event"
            @update:show-cancelled="filterState.showCancelled = $event"
            @update:calendar-view="calendarView = $event"
            @go-to-today="onGoToToday"
            @add-location="onAddLocation"
            @edit-location="onEditLocation"
            @focus-on-map="onFocusOnMap"
          />
        </div>

        <!-- Calendar -->
        <div v-if="showCalendar" class="px-2 pb-2">
          <CroutonBookingsCalendar
            v-model:filters="filterState"
            v-model:date="shownDate"
            :bookings="resolvedCalendarBookings"
            :locations="resolvedLocations"
            :settings="resolvedSettings"
            :view="calendarView"
            :selected-date="selectedDate"
            :creating-at-date="creatingAtDate"
            :is-date-unavailable="isDateUnavailableForAll"
            :get-blocked-reason="getBlockedReasonForAll"
            @select="onCalendarSelect"
            @day-click="onCalendarDayClick"
            @hover-booking="(id) => hoveredBookingId = id"
          />
        </div>
      </div>

      <!-- Scroll area: map + list -->
      <div ref="scrollAreaRef" class="flex-1 min-h-0 overflow-y-auto">
        <!-- Map section (scrolls with content) -->
        <Transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 max-h-0"
          enter-to-class="opacity-100 max-h-[300px]"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 max-h-[300px]"
          leave-to-class="opacity-0 max-h-0"
        >
          <div v-if="showMap && hasLocationsWithCoordinates" class="px-2 pt-3 md:px-4 md:pt-4">
            <CroutonBookingsPanelMap
              ref="panelMapRef"
              :locations="resolvedLocations"
              :selected-locations="filterState.locations"
              @toggle-location="toggleLocation"
              @ready="onMapReady"
            />
          </div>
        </Transition>

        <!-- List section -->
        <div class="px-2 py-3 md:px-4 md:py-4">
          <CroutonBookingsList
            :scroll-root="scrollAreaRef"
            :bookings="filteredBookings"
            :loading="resolvedLoading"
            :error="resolvedError"
            :has-active-filters="hasActiveFilters"
            :selected-date="selectedDate"
            :highlighted-booking-id="hoveredBookingId"
            :creating-at-date="creatingAtDate"
            :scroll-target="scrollTarget"
            :active-location-filter="filterState.locations"
            :empty-message="resolvedEmptyMessage"
            @created="onBookingCreated"
            :is-day-fully-booked="isDayFullyBookedAllLocations"
            @cancel-create="onCancelCreate"
            @new-booking="onCalendarDayClick"
            @top-visible-date-change="onTopVisibleDateChange"
            @date-click="selectDate"
            @updated="onBookingUpdated"
            @email-sent="onEmailSent"
          />
        </div>
        </div>
  </div>
</template>

