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

// Ref for Calendar control (to sync with list scroll)
const calendarRef = ref<{ goToDate: (date: Date) => void, goToToday: () => void } | null>(null)

// Ref for PanelMap control (to fly to specific locations)
const panelMapRef = ref<{ flyToLocation: (locationId: string) => void } | null>(null)

// Scroll direction detection — reveals filters on scroll-up, hides on scroll-down
const scrollingUp = ref(false)
let lastScrollY = 0

function onScroll() {
  const y = window.scrollY
  scrollingUp.value = y < lastScrollY
  lastScrollY = y
}

onMounted(() => {
  lastScrollY = window.scrollY
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})

// Crouton form and team auth for location creation
const { open: openCroutonForm } = useCrouton()
const { isAdmin } = useTeam()
const notify = useNotify()
const { parseSlotIds } = useBookingSlots()

// Preview mode - injected from admin page, defaults to false
const previewMode = inject<Ref<boolean>>('bookings-preview-mode', ref(false))

// Schedule rules per location — used to disable closed days in the calendar
const locationScheduleRules = computed(() => {
  return resolvedLocations.value.map((location) => {
    const openDaysRaw = location.openDays
    let openDays: number[] | null = null
    if (openDaysRaw != null) {
      if (Array.isArray(openDaysRaw)) {
        openDays = openDaysRaw.length > 0 ? openDaysRaw : null
      } else if (typeof openDaysRaw === 'string') {
        try {
          const parsed = JSON.parse(openDaysRaw)
          openDays = Array.isArray(parsed) && parsed.length > 0 ? parsed : null
        } catch {
          openDays = null
        }
      }
    }

    let blockedDates: { startDate: string, endDate: string, blockedSlots?: string[] }[] = []
    const blockedRaw = location.blockedDates
    if (blockedRaw != null) {
      if (Array.isArray(blockedRaw)) {
        blockedDates = blockedRaw
      } else if (typeof blockedRaw === 'string') {
        try {
          const parsed = JSON.parse(blockedRaw)
          blockedDates = Array.isArray(parsed) ? parsed : []
        } catch {
          blockedDates = []
        }
      }
    }

    return { openDays, blockedDates }
  })
})

// Check if ALL visible locations are unavailable on a date (closed or fully blocked)
function isDateUnavailableForAll(date: Date): boolean {
  const rules = locationScheduleRules.value
  if (rules.length === 0) return false

  const dayOfWeek = date.getDay()
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  return rules.every(({ openDays, blockedDates }) => {
    // Check openDays
    if (openDays && !openDays.includes(dayOfWeek)) return true

    // Check full-day blocked dates
    for (const blocked of blockedDates) {
      if (!blocked.startDate || !blocked.endDate) continue
      if (dateKey >= blocked.startDate && dateKey <= blocked.endDate) {
        if (!blocked.blockedSlots || blocked.blockedSlots.length === 0) return true
      }
    }

    return false
  })
}

// Get reason why a date is unavailable
function getBlockedReasonForAll(date: Date): string | null {
  if (!isDateUnavailableForAll(date)) return null

  const dayOfWeek = date.getDay()
  const rules = locationScheduleRules.value
  const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  // Check if all are closed by openDays
  const allClosedByOpenDays = rules.every(({ openDays }) => openDays && !openDays.includes(dayOfWeek))
  if (allClosedByOpenDays) return t('bookings.calendar.closed')

  // Check for blocked date reason
  for (const { blockedDates } of rules) {
    for (const blocked of blockedDates) {
      if (!blocked.startDate || !blocked.endDate) continue
      if (dateKey >= blocked.startDate && dateKey <= blocked.endDate) {
        if (!blocked.blockedSlots || blocked.blockedSlots.length === 0) {
          return (blocked as { reason?: string }).reason || t('bookings.calendar.blocked')
        }
      }
    }
  }

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

// Selected dates (from calendar clicks) - toggle multi-select to highlight bookings
const selectedDates = ref<Date[]>([])

// Hovered booking ID (from calendar indicator hover) - used to highlight specific booking in list
const hoveredBookingId = ref<string | null>(null)

// Filter state (status, location and showCancelled toggle)
const filterState = ref<FilterState>({
  statuses: props.initialFilters.statuses ?? [],
  locations: props.initialFilters.locations ?? [],
  showCancelled: props.initialFilters.showCancelled ?? false,
})

// Visibility states for panel sections
const showCalendar = ref(true)
const showLocations = ref(false)
const showMap = ref(false)

// Calendar view mode (lifted from Calendar component)
const calendarView = ref<'week' | 'month'>('week')

// Handle go-to-today from pill controls
function onGoToToday() {
  calendarRef.value?.goToToday()
}

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
function toggleLocation(locationId: string) {
  const current = [...filterState.value.locations]
  const index = current.indexOf(locationId)
  if (index === -1) {
    current.push(locationId)
  } else {
    current.splice(index, 1)
  }
  filterState.value.locations = current
}

// Emit filter changes
watch(filterState, (newFilters) => {
  emit('update:filters', { ...newFilters })
}, { deep: true })

// Inline creation state - date where we're creating a booking
const creatingAtDate = ref<Date | null>(null)

// Watch for booking creation signal from shared state.
// The emit('created') chain from BookingCreateCard → List → Panel can be lost
// when the async refreshMyBookings() unmounts the component mid-propagation.
const { lastBookingCreatedAt } = useBookingCart()
watch(lastBookingCreatedAt, (ts) => {
  if (ts && creatingAtDate.value) {
    onBookingCreated()
  }
})

// Scroll to date - triggers scroll after booking creation
const scrollToDate = ref<Date | null>(null)

// Check if any filters are active
const hasActiveFilters = computed(() => {
  return filterState.value.statuses.length > 0
    || filterState.value.locations.length > 0
    || filterState.value.showCancelled
})

// Apply filters to bookings
const filteredBookings = computed(() => {
  let result = resolvedBookings.value

  // Filter cancelled bookings based on toggle
  // By default (showCancelled = false), hide cancelled bookings
  if (!filterState.value.showCancelled) {
    result = result.filter(booking => booking.status !== 'cancelled')
  }

  // Filter by specific statuses if provided
  if (filterState.value.statuses.length > 0) {
    result = result.filter(booking =>
      filterState.value.statuses.includes(booking.status),
    )
  }

  // Filter by location
  if (filterState.value.locations.length > 0) {
    result = result.filter(booking =>
      filterState.value.locations.includes(booking.location),
    )
  }

  return result
})

// Helper to compare dates by day
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

// Handle calendar day select - toggle date in multi-select array
function onCalendarSelect(date: Date | null) {
  if (!date) return
  const idx = selectedDates.value.findIndex(d => isSameDay(d, date))
  if (idx !== -1) {
    selectedDates.value.splice(idx, 1)
  } else {
    selectedDates.value.push(date)
  }
}

// Check if all locations are fully booked for a given date
function isDayFullyBookedAllLocations(date: Date): boolean {
  const locations = resolvedLocations.value
  if (locations.length === 0) return false

  const dateStr = date.toISOString().split('T')[0]

  // Get non-cancelled bookings for this date (use calendar bookings for accurate team-wide availability)
  const dateBookings = resolvedCalendarBookings.value.filter((b) => {
    const bookingDate = new Date(b.date).toISOString().split('T')[0]
    return bookingDate === dateStr && b.status !== 'cancelled'
  })

  return locations.every((location) => {
    const locationBookings = dateBookings.filter(b => b.location === location.id)

    if (location.inventoryMode) {
      const quantity = location.quantity ?? 0
      return locationBookings.length >= quantity
    }

    // Slot mode: parse location slots
    let slots: { id: string; capacity?: number }[] = []
    if (location.slots) {
      if (typeof location.slots === 'string') {
        try { slots = JSON.parse(location.slots) }
        catch { slots = [] }
      }
      else if (Array.isArray(location.slots)) {
        slots = location.slots
      }
    }

    // No named slots → single "all-day" slot with capacity 1
    if (slots.length === 0) {
      return locationBookings.length >= 1
    }

    // Check each slot's capacity
    return slots.every((slot) => {
      const capacity = slot.capacity ?? 1
      const bookedCount = locationBookings.filter((b) => {
        const ids = parseSlotIds(b.slot)
        return ids.includes(slot.id)
      }).length
      return bookedCount >= capacity
    })
  })
}

// Handle calendar day click (+ button) - start inline creation at that date (disabled in preview mode)
function onCalendarDayClick(date: Date) {
  if (previewMode.value) return
  if (resolvedLocations.value.length === 0) return

  if (isDateUnavailableForAll(date)) return

  if (isDayFullyBookedAllLocations(date)) {
    notify.warning(t('bookings.notifications.allSlotsTaken'), {
      description: t('bookings.notifications.allSlotsTakenDescription'),
    })
    return
  }

  creatingAtDate.value = date
}

// Handle booking created - refresh all data (including calendar indicators), then scroll
function onBookingCreated() {
  const dateToScrollTo = creatingAtDate.value
  creatingAtDate.value = null
  emit('created')

  // Refresh all data so calendar indicators update immediately
  refresh()

  if (!dateToScrollTo) return

  // submitAll() (running in background for auto-book) calls refreshMyBookings()
  // which updates resolvedBookings. Wait for that data change before scrolling
  // so the DOM is stable and the new booking element exists.
  const stop = watch(resolvedBookings, async () => {
    stop()
    await nextTick()
    scrollToDate.value = dateToScrollTo
  })

  // Safety: if no data change within 5s (e.g. API failure), clean up
  setTimeout(() => stop(), 5000)
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
function onCancelCreate() {
  creatingAtDate.value = null
}

// Handle list scroll - sync calendar to top visible date (week changes)
function onTopVisibleDateChange(date: Date) {
  calendarRef.value?.goToDate(date)
}

// Handle click on booking date - navigate calendar and toggle selection
function onDateClick(date: Date) {
  calendarRef.value?.goToDate(date)
  onCalendarSelect(date)
}

// Expose methods for external control
defineExpose({
  refresh,
  goToDate: (date: Date) => calendarRef.value?.goToDate(date),
})
</script>

<template>
  <div class="booking-panel rounded-[calc(var(--ui-radius)*2)] border border-default bg-default">
      <!-- Sticky: filters + calendar. Negative top hides filters above viewport;
           scrolling up reveals them. Calendar stays pinned. -->
      <div class="sticky z-20 bg-default rounded-t-[calc(var(--ui-radius)*2)] transition-[top] duration-300 flex flex-col gap-2" :class="scrollingUp ? 'top-0' : '-top-12'">
        <!-- Filter controls (hidden above viewport when stuck) -->
        <div class="px-2 pt-2 pb-1.5 md:px-4 md:pt-3 md:pb-2">
          <CroutonBookingsPanelFilters
            :locations="resolvedLocations"
            :selected-locations="filterState.locations"
            :selected-dates-count="selectedDates.length"
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
        <div v-if="showCalendar" class="border-b border-default px-2 pb-2">
          <CroutonBookingsCalendar
            ref="calendarRef"
            v-model:filters="filterState"
            :bookings="resolvedCalendarBookings"
            :locations="resolvedLocations"
            :settings="resolvedSettings"
            :view="calendarView"
            :selected-dates="selectedDates"
            :creating-at-date="creatingAtDate"
            :is-date-unavailable="isDateUnavailableForAll"
            :get-blocked-reason="getBlockedReasonForAll"
            @select="onCalendarSelect"
            @day-click="onCalendarDayClick"
            @hover-booking="(id) => hoveredBookingId = id"
          />
        </div>
        <div v-else class="border-b border-default" />
      </div>

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
          :bookings="filteredBookings"
          :loading="resolvedLoading"
          :error="resolvedError"
          :has-active-filters="hasActiveFilters"
          :selected-dates="selectedDates"
          :highlighted-booking-id="hoveredBookingId"
          :creating-at-date="creatingAtDate"
          :scroll-to-date="scrollToDate"
          :active-location-filter="filterState.locations"
          :empty-message="resolvedEmptyMessage"
          @created="onBookingCreated"
          :is-day-fully-booked="isDayFullyBookedAllLocations"
          @cancel-create="onCancelCreate"
          @new-booking="onCalendarDayClick"
          @top-visible-date-change="onTopVisibleDateChange"
          @date-click="onDateClick"
          @updated="onBookingUpdated"
          @email-sent="onEmailSent"
        />
      </div>
  </div>
</template>

