<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date'
import type { Booking, LocationData, SettingsData, SlotItem } from '../types/booking'

interface FilterState {
  statuses: string[]
  locations: string[]
  showCancelled?: boolean
}

interface Props {
  bookings?: Booking[]
  locations?: LocationData[]
  settings?: SettingsData | null
  /** Current view mode, controlled by parent */
  view?: 'week' | 'month'
  /** Filter state for status and location filters */
  filters?: FilterState
  /** Dates to highlight (selected dates from click multi-select) */
  selectedDates?: Date[]
  /** Date currently being used for booking creation */
  creatingAtDate?: Date | null
  /** Function to check if a date is unavailable by schedule rules */
  isDateUnavailable?: ((date: Date) => boolean) | null
  /** Function to get blocked reason for tooltip */
  getBlockedReason?: ((date: Date) => string | null) | null
}

const props = withDefaults(defineProps<Props>(), {
  bookings: () => [],
  locations: () => [],
  settings: null,
  view: 'week',
  filters: () => ({ statuses: [], locations: [], showCancelled: false }),
  selectedDates: () => [],
  creatingAtDate: null,
  isDateUnavailable: null,
  getBlockedReason: null,
})

const emit = defineEmits<{
  'select': [value: Date | null]
  'dayClick': [value: Date]
  'update:filters': [value: FilterState]
  'update:view': [value: 'week' | 'month']
  'hoverBooking': [bookingId: string | null]
}>()

const { t } = useT()
const { locale } = useI18n()

const { parseSlotIds, parseLocationSlots } = useBookingSlots()

// Get localized location title with fallbacks
function getLocationTitle(location: LocationData): string {
  const translations = location.translations as Record<string, { title?: string }> | undefined

  return translations?.[locale.value]?.title
    || translations?.en?.title
    || location.title
    || t('bookings.untitled')
}

// Ref for WeekStrip control
const weekStripRef = ref<{ goToDate: (date: Date) => void, goToToday: () => void } | null>(null)

// Navigate to a specific date (works for both week and month view)
function goToDate(date: Date) {
  if (currentView.value === 'week') {
    weekStripRef.value?.goToDate(date)
  } else {
    // Update month view to show the month containing this date
    monthFocusDate.value = new CalendarDate(
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
    )
  }
}

// Navigate to today
function goToToday() {
  const todayDate = today(getLocalTimeZone())
  const jsDate = todayDate.toDate(getLocalTimeZone())
  goToDate(jsDate)
  // Also select today as if it was clicked
  emit('select', jsDate)
}

// Expose methods for parent control
defineExpose({
  goToDate,
  goToToday,
})

// View is controlled by parent via v-model:view
const currentView = computed(() => props.view)

// For month view: track focused month (no selection)
const monthFocusDate = ref<DateValue | undefined>(new CalendarDate(
  new Date().getFullYear(),
  new Date().getMonth() + 1,
  1
))

// Parse statuses from settings
const parsedStatuses = computed(() => {
  const raw = props.settings?.statuses
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    }
    catch {
      return []
    }
  }
  return []
})

// Toggle status filter (kept for backward compatibility)
function toggleStatus(statusValue: string) {
  const current = [...props.filters.statuses]
  const index = current.indexOf(statusValue)
  if (index === -1) {
    current.push(statusValue)
  }
  else {
    current.splice(index, 1)
  }
  emit('update:filters', { ...props.filters, statuses: current })
}

// Toggle location filter
function toggleLocation(locationId: string) {
  const current = [...props.filters.locations]
  const index = current.indexOf(locationId)
  if (index === -1) {
    current.push(locationId)
  }
  else {
    current.splice(index, 1)
  }
  emit('update:filters', { ...props.filters, locations: current })
}

// Get status color
function getStatusColor(status: { id: string, color?: string }): string {
  return status.color || '#6b7280'
}

// Check if status is selected
function isStatusSelected(statusValue: string): boolean {
  return props.filters.statuses.includes(statusValue)
}

// Filter bookings based on current filters
const filteredBookings = computed(() => {
  let result = props.bookings

  // Filter cancelled bookings based on toggle
  // By default (showCancelled = false), hide cancelled bookings
  if (!props.filters.showCancelled) {
    result = result.filter(booking => booking.status !== 'cancelled')
  }

  // Legacy: Filter by specific statuses if provided (for backward compatibility)
  if (props.filters.statuses.length > 0) {
    result = result.filter(booking =>
      props.filters.statuses.includes(booking.status),
    )
  }

  // Filter by location
  if (props.filters.locations.length > 0) {
    result = result.filter(booking =>
      props.filters.locations.includes(booking.location),
    )
  }

  return result
})

// Group bookings by date string (YYYY-MM-DD) - uses filtered bookings
const bookingsByDate = computed(() => {
  const map = new Map<string, Booking[]>()
  for (const booking of filteredBookings.value) {
    const date = new Date(booking.date)
    const key = formatDateKey(date)
    if (!map.has(key)) {
      map.set(key, [])
    }
    map.get(key)!.push(booking)
  }
  return map
})

// Format date as YYYY-MM-DD for map key
function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Get bookings for a specific date
function getBookingsForDate(date: Date): Booking[] {
  const key = formatDateKey(date)
  return bookingsByDate.value.get(key) || []
}

// Per-slot status for capacity-aware indicators
interface SlotStatus {
  id: string
  label: string
  bookedCount: number
  cancelledCount: number
  capacity: number
  isFull: boolean
}

interface IndicatorData {
  locationId: string
  locationTitle: string
  color: string
  slots: SlotItem[]
  bookedSlotIds: string[]
  partialSlotIds: string[]
  cancelledSlotIds: string[]
  bookings: Booking[]
  slotStatuses: SlotStatus[]
  isInventoryMode: boolean
  inventoryQuantity: number
  inventoryBookedCount: number
}

// Get indicators data for a specific date (all locations, capacity-aware)
function getIndicatorsForDate(date: Date): IndicatorData[] {
  const dayBookings = getBookingsForDate(date)

  // Group bookings by location
  const byLocation = new Map<string, Booking[]>()
  for (const booking of dayBookings) {
    const locId = booking.location
    if (!byLocation.has(locId)) {
      byLocation.set(locId, [])
    }
    byLocation.get(locId)!.push(booking)
  }

  // Determine which locations to show (respect location filter)
  const visibleLocations = props.filters.locations.length > 0
    ? props.locations.filter(l => props.filters.locations.includes(l.id))
    : props.locations

  const indicators: IndicatorData[] = []

  for (const location of visibleLocations) {
    const isInventoryMode = !!location.inventoryMode
    // Inventory mode ignores named slots — treat as single all-day unit
    const locationSlots = isInventoryMode ? [] : parseLocationSlots(location)
    const effectiveSlots = locationSlots.length > 0
      ? locationSlots
      : [{ id: 'all-day', label: t('bookings.allDay') }]

    const locationBookings = byLocation.get(location.id) || []

    // For inventory mode, capacity is the location quantity
    const inventoryQuantity = location.quantity ?? 1

    // Build per-slot statuses with capacity awareness
    const slotStatuses: SlotStatus[] = []
    const bookedSlotIds: string[] = []
    const partialSlotIds: string[] = []
    const cancelledSlotIds: string[] = []

    for (const slot of effectiveSlots) {
      // For inventory mode, capacity comes from location quantity
      const capacity = isInventoryMode ? inventoryQuantity : (slot.capacity ?? 1)

      let activeCount = 0
      let cancelledCount = 0

      for (const booking of locationBookings) {
        // Inventory mode: slot is null, all bookings match; sum quantity
        if (isInventoryMode) {
          const qty = booking.quantity ?? 1
          if (booking.status === 'cancelled') {
            cancelledCount += qty
          } else {
            activeCount += qty
          }
          continue
        }

        const slotIds = parseSlotIds(booking.slot)
        const matchesSlot = slotIds.includes(slot.id) || slotIds.includes('all-day')
        if (!matchesSlot) continue

        if (booking.status === 'cancelled') {
          cancelledCount++
        } else {
          activeCount++
        }
      }

      const isFull = activeCount >= capacity

      slotStatuses.push({
        id: slot.id,
        label: slot.label || slot.id,
        bookedCount: activeCount,
        cancelledCount,
        capacity,
        isFull,
      })

      if (isFull) {
        bookedSlotIds.push(slot.id)
      } else if (activeCount > 0) {
        partialSlotIds.push(slot.id)
      }

      if (cancelledCount > 0) {
        cancelledSlotIds.push(slot.id)
      }
    }

    const totalActiveBookings = locationBookings
      .filter(b => b.status !== 'cancelled')
      .reduce((sum, b) => sum + (b.quantity ?? 1), 0)

    indicators.push({
      locationId: location.id,
      locationTitle: getLocationTitle(location),
      color: location.color || '#3b82f6',
      slots: effectiveSlots,
      bookedSlotIds,
      partialSlotIds,
      cancelledSlotIds,
      bookings: locationBookings,
      slotStatuses,
      isInventoryMode,
      inventoryQuantity,
      inventoryBookedCount: totalActiveBookings,
    })
  }

  return indicators
}

// Handle week strip select (day click) - only if date has bookings
function onWeekSelect(date: Date | null) {
  if (!date || !hasBookings(date)) return
  emit('select', date)
}

// Handle week strip click (for booking creation)
function onWeekDayClick(date: Date) {
  emit('dayClick', date)
}

// Check if a date has bookings
function hasBookings(date: Date): boolean {
  const key = formatDateKey(date)
  return bookingsByDate.value.has(key)
}

// Check if a date is highlighted (selected) for month view
function isDayHighlighted(date: Date): boolean {
  return props.selectedDates.some(d =>
    date.getFullYear() === d.getFullYear()
    && date.getMonth() === d.getMonth()
    && date.getDate() === d.getDate(),
  )
}

// Check if we're in create mode
const isCreating = computed(() => props.creatingAtDate !== null)

// Check if a date is the creating date
function isCreatingDate(date: Date): boolean {
  if (!props.creatingAtDate) return false
  return (
    date.getFullYear() === props.creatingAtDate.getFullYear()
    && date.getMonth() === props.creatingAtDate.getMonth()
    && date.getDate() === props.creatingAtDate.getDate()
  )
}

// Check if a date is unavailable by schedule rules
function isDayUnavailable(date: Date): boolean {
  return props.isDateUnavailable?.(date) ?? false
}

// Get blocked reason for tooltip
function getDayBlockedReason(date: Date): string | null {
  return props.getBlockedReason?.(date) ?? null
}
// Check if a date is fully booked across all visible locations
function isDayFullyBooked(date: Date): boolean {
  const indicators = getIndicatorsForDate(date)
  if (indicators.length === 0) return false

  return indicators.every((indicator) => {
    if (indicator.isInventoryMode) {
      return indicator.inventoryBookedCount >= indicator.inventoryQuantity
    }
    // All slots must be full
    return indicator.slotStatuses.length > 0 && indicator.slotStatuses.every(s => s.isFull)
  })
}

// Compute max indicators across all days for uniform row height
// Since we now show all locations on every day, this is the count of visible locations with slots
const maxIndicatorCount = computed(() => {
  const visibleLocations = props.filters.locations.length > 0
    ? props.locations.filter(l => props.filters.locations.includes(l.id))
    : props.locations
  return visibleLocations.length
})

// The location with the most slots renders as dots (fixed size) to define the width.
// All other locations render as bars that stretch to fill the same width.
const maxSlotCount = computed(() => {
  const visibleLocations = props.filters.locations.length > 0
    ? props.locations.filter(l => props.filters.locations.includes(l.id))
    : props.locations
  let max = 0
  for (const location of visibleLocations) {
    // Inventory mode locations have a single all-day slot (count as 1)
    const slotCount = location.inventoryMode ? 1 : Math.max(parseLocationSlots(location).length, 1)
    if (slotCount > max) max = slotCount
  }
  return max
})

// Look up full location data by ID
function getLocationById(locationId: string): LocationData | undefined {
  return props.locations.find(l => l.id === locationId)
}

// Get localized address string for a location
function getLocationAddress(locationId: string): string | null {
  const location = getLocationById(locationId)
  if (!location) return null
  const translations = location.translations as Record<string, { street?: string, zip?: string, city?: string }> | undefined

  const street = translations?.[locale.value]?.street || translations?.en?.street || location.street
  const zip = translations?.[locale.value]?.zip || translations?.en?.zip || location.zip
  const city = translations?.[locale.value]?.city || translations?.en?.city || location.city

  const parts = [street, [zip, city].filter(Boolean).join(' ')].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

// Calculate cell height based on max indicators
// Base height: 20px (day number) + padding
// Each indicator row: ~10px
const monthCellHeight = computed(() => {
  const baseHeight = 24 // day number + top padding
  const indicatorHeight = 10 // per indicator row
  const bottomPadding = 4
  const minHeight = 40
  return Math.max(minHeight, baseHeight + (maxIndicatorCount.value * indicatorHeight) + bottomPadding)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Week View -->
    <CroutonBookingsWeekStrip
      v-if="currentView === 'week'"
      ref="weekStripRef"
      size="md"
      :selected-dates="selectedDates"
      :creating-at-date="creatingAtDate"
      :is-date-disabled="isDateUnavailable ? isDayUnavailable : undefined"
      :is-day-fully-booked="isDayFullyBooked"
      @select="onWeekSelect"
      @day-click="onWeekDayClick"
    >
      <template #day="{ jsDate }">
        <div class="flex flex-col gap-1 mt-1 min-h-[12px] w-fit mx-auto">
          <UPopover
            v-for="indicator in getIndicatorsForDate(jsDate)"
            :key="indicator.locationId"
            mode="hover"
            :open-delay="300"
            :close-delay="100"
          >
            <CroutonBookingsSlotIndicator
              :slots="indicator.slots"
              :booked-slot-ids="indicator.bookedSlotIds"
              :partial-slot-ids="indicator.partialSlotIds"
              :cancelled-slot-ids="indicator.cancelledSlotIds"
              :bookings="indicator.bookings"
              :color="indicator.color"
              size="sm"
              :variant="indicator.slots.length >= maxSlotCount ? 'dots' : 'bars'"
              @hover-booking="(id) => emit('hoverBooking', id)"
            />
            <template #content>
              <div class="p-3 min-w-44 max-w-60">
                <div class="flex items-center gap-2">
                  <span class="size-2.5 rounded-full shrink-0" :style="{ backgroundColor: indicator.color }" />
                  <span class="text-sm font-medium text-highlighted truncate">{{ indicator.locationTitle }}</span>
                </div>
                <p v-if="getLocationAddress(indicator.locationId)" class="text-xs text-muted mt-1">
                  {{ getLocationAddress(indicator.locationId) }}
                </p>

                <!-- Inventory mode summary -->
                <div v-if="indicator.isInventoryMode" class="mt-2 flex items-center justify-between text-xs">
                  <span class="text-muted">{{ t('bookings.calendar.units') }}</span>
                  <span class="tabular-nums" :class="indicator.inventoryBookedCount >= indicator.inventoryQuantity ? 'text-red-400' : 'text-dimmed'">
                    {{ indicator.inventoryBookedCount }} / {{ indicator.inventoryQuantity }}
                  </span>
                </div>

                <!-- Slot mode: per-slot breakdown -->
                <div v-else-if="indicator.slotStatuses.length > 1 || (indicator.slotStatuses[0]?.capacity ?? 0) > 1" class="mt-2 flex flex-col gap-0.5">
                  <div
                    v-for="slot in indicator.slotStatuses"
                    :key="slot.id"
                    class="flex items-center justify-between gap-3 text-xs"
                  >
                    <span class="text-muted truncate">{{ slot.label }}</span>
                    <span class="shrink-0 tabular-nums" :class="slot.isFull ? 'text-red-400' : 'text-dimmed'">
                      {{ slot.bookedCount }} / {{ slot.capacity }}
                    </span>
                  </div>
                </div>

                <!-- Simple count for single all-day slot with capacity 1 -->
                <p v-else class="text-xs text-dimmed mt-1">
                  {{ indicator.bookings.length > 0 ? (t as any)('bookings.calendar.bookingCount', { count: indicator.bookings.length }, indicator.bookings.length) : t('bookings.calendar.noBookings') }}
                </p>
              </div>
            </template>
          </UPopover>
        </div>
      </template>
    </CroutonBookingsWeekStrip>

    <!-- Month View -->
    <div v-else class="w-full">
      <UCalendar
        :model-value="(monthFocusDate as any)"
        @update:model-value="(value: any) => { monthFocusDate = value }"
        size="sm"
        :week-starts-on="1"
        :ui="{
          root: 'w-full',
          header: 'flex items-center justify-center gap-1',
          heading: 'text-center font-medium truncate mx-0',
          body: 'p-1',
          grid: 'w-full',
          headCell: 'text-center text-xs',
          cell: 'w-full text-center p-0.5',
          cellTrigger: 'w-full h-full p-0 rounded-md data-[selected]:bg-transparent data-[selected]:text-inherit hover:bg-transparent focus:bg-transparent',
        }"
        class="[&_table]:w-full [&_table]:table-fixed"
      >
        <template #day="{ day }">
          <div
            class="group relative w-full flex flex-col items-center justify-start pt-1 pb-1 rounded-md transition-all duration-200"
            :style="{ minHeight: `${monthCellHeight}px` }"
            :class="[
              isDayUnavailable(day.toDate(getLocalTimeZone()))
                ? 'opacity-40 bg-muted/10'
                : isCreatingDate(day.toDate(getLocalTimeZone()))
                  ? 'bg-elevated shadow-md'
                  : isDayHighlighted(day.toDate(getLocalTimeZone()))
                    ? 'bg-elevated shadow-sm'
                    : 'hover:bg-elevated/80',
              hasBookings(day.toDate(getLocalTimeZone())) && !isDayUnavailable(day.toDate(getLocalTimeZone()))
                ? 'bg-muted/30 cursor-pointer'
                : '',
            ]"
            :title="getDayBlockedReason(day.toDate(getLocalTimeZone())) || undefined"
            :role="hasBookings(day.toDate(getLocalTimeZone())) ? 'button' : undefined"
            :tabindex="hasBookings(day.toDate(getLocalTimeZone())) && !isDayUnavailable(day.toDate(getLocalTimeZone())) ? 0 : undefined"
            @click="hasBookings(day.toDate(getLocalTimeZone())) && emit('select', day.toDate(getLocalTimeZone()))"
            @keydown.enter.prevent="hasBookings(day.toDate(getLocalTimeZone())) && emit('select', day.toDate(getLocalTimeZone()))"
            @keydown.space.prevent="hasBookings(day.toDate(getLocalTimeZone())) && emit('select', day.toDate(getLocalTimeZone()))"
          >
            <!-- Day number -->
            <span
              class="text-xs font-medium transition-colors"
              :class="[
                isDayUnavailable(day.toDate(getLocalTimeZone()))
                  ? 'text-muted line-through'
                  : isDayHighlighted(day.toDate(getLocalTimeZone()))
                    ? 'text-primary'
                    : hasBookings(day.toDate(getLocalTimeZone()))
                      ? 'text-default'
                      : 'text-muted',
              ]"
            >
              {{ day.day }}
            </span>

            <!-- Slot indicators (all locations) -->
            <div class="flex flex-col gap-1 mt-0.5 w-fit mx-auto">
              <UPopover
                v-for="indicator in getIndicatorsForDate(day.toDate(getLocalTimeZone()))"
                :key="indicator.locationId"
                mode="hover"
                :open-delay="300"
                :close-delay="100"
              >
                <CroutonBookingsSlotIndicator
                  :slots="indicator.slots"
                  :booked-slot-ids="indicator.bookedSlotIds"
                  :partial-slot-ids="indicator.partialSlotIds"
                  :cancelled-slot-ids="indicator.cancelledSlotIds"
                  :bookings="indicator.bookings"
                  :color="indicator.color"
                  size="xs"
                  :variant="indicator.slots.length >= maxSlotCount ? 'dots' : 'bars'"
                  @hover-booking="(id) => emit('hoverBooking', id)"
                />
                <template #content>
                  <div class="p-3 min-w-44 max-w-60">
                    <div class="flex items-center gap-2">
                      <span class="size-2.5 rounded-full shrink-0" :style="{ backgroundColor: indicator.color }" />
                      <span class="text-sm font-medium text-highlighted truncate">{{ indicator.locationTitle }}</span>
                    </div>
                    <p v-if="getLocationAddress(indicator.locationId)" class="text-xs text-muted mt-1">
                      {{ getLocationAddress(indicator.locationId) }}
                    </p>

                    <!-- Inventory mode summary -->
                    <div v-if="indicator.isInventoryMode" class="mt-2 flex items-center justify-between text-xs">
                      <span class="text-muted">{{ t('bookings.calendar.units') }}</span>
                      <span class="tabular-nums" :class="indicator.inventoryBookedCount >= indicator.inventoryQuantity ? 'text-red-400' : 'text-dimmed'">
                        {{ indicator.inventoryBookedCount }} / {{ indicator.inventoryQuantity }}
                      </span>
                    </div>

                    <!-- Slot mode: per-slot breakdown -->
                    <div v-else-if="indicator.slotStatuses.length > 1 || (indicator.slotStatuses[0]?.capacity ?? 0) > 1" class="mt-2 flex flex-col gap-0.5">
                      <div
                        v-for="slot in indicator.slotStatuses"
                        :key="slot.id"
                        class="flex items-center justify-between gap-3 text-xs"
                      >
                        <span class="text-muted truncate">{{ slot.label }}</span>
                        <span class="shrink-0 tabular-nums" :class="slot.isFull ? 'text-red-400' : 'text-dimmed'">
                          {{ slot.bookedCount }} / {{ slot.capacity }}
                        </span>
                      </div>
                    </div>

                    <!-- Simple count for single all-day slot with capacity 1 -->
                    <p v-else class="text-xs text-dimmed mt-1">
                      {{ indicator.bookings.length > 0 ? (t as any)('bookings.calendar.bookingCount', { count: indicator.bookings.length }, indicator.bookings.length) : t('bookings.calendar.noBookings') }}
                    </p>
                  </div>
                </template>
              </UPopover>
            </div>

            <!-- Add booking tab (slides down from under the date block on hover) -->
            <!-- Deliberately a raw button (#1410): a calendar hover cell whose
                 geometry (absolute slide-down tab under the date block) and
                 booked-state colors are the widget itself — no Nuxt UI equivalent.
                 Colors use semantic tokens where possible. -->
            <button
              v-if="!isCreatingDate(day.toDate(getLocalTimeZone()))"
              type="button"
              :disabled="isDayFullyBooked(day.toDate(getLocalTimeZone()))"
              class="absolute bottom-0 left-0 right-0 translate-y-0 flex items-center justify-center h-4 rounded-b-md opacity-0 transition-all duration-200 ease-out group-hover:translate-y-1 group-hover:opacity-100 z-10"
              :class="isDayFullyBooked(day.toDate(getLocalTimeZone()))
                ? 'bg-neutral-700 cursor-default'
                : 'bg-primary cursor-pointer hover:bg-primary/80 active:scale-[0.98]'"
              @click.stop="!isDayFullyBooked(day.toDate(getLocalTimeZone())) && emit('dayClick', day.toDate(getLocalTimeZone()))"
            >
              <UIcon
                :name="isDayFullyBooked(day.toDate(getLocalTimeZone())) ? 'i-lucide-check' : 'i-lucide-plus'"
                class="size-2.5"
                :class="isDayFullyBooked(day.toDate(getLocalTimeZone())) ? 'text-neutral-500' : 'text-neutral-300'"
              />
            </button>
          </div>
        </template>
      </UCalendar>
    </div>
  </div>
</template>
