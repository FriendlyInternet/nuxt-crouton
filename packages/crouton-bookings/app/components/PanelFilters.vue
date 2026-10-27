<script setup lang="ts">
import type { LocationData } from '../types/booking'

interface Props {
  locations: LocationData[]
  /** Selected location IDs */
  selectedLocations: string[]
  /** Whether locations panel is expanded */
  showLocations: boolean
  /** Whether map is visible */
  showMap: boolean
  /** Whether calendar is visible */
  showCalendar: boolean
  /** Whether there are locations with coordinates (for map toggle) */
  hasLocationsWithCoordinates: boolean
  /** Whether a day is selected in the calendar */
  hasSelectedDate?: boolean
  /** Whether to show cancelled bookings */
  showCancelled: boolean
  /** Whether user can manage locations (admin) */
  canManageLocations?: boolean
  /** Current calendar view mode */
  calendarView?: 'week' | 'month'
}

const props = withDefaults(defineProps<Props>(), {
  canManageLocations: false,
  calendarView: 'week',
  hasSelectedDate: false,
})

const emit = defineEmits<{
  'update:selectedLocations': [value: string[]]
  'update:showLocations': [value: boolean]
  'update:showMap': [value: boolean]
  'update:showCalendar': [value: boolean]
  'update:showCancelled': [value: boolean]
  'update:calendarView': [value: 'week' | 'month']
  'go-to-today': []
  'add-location': []
  'edit-location': [location: LocationData]
  'focus-on-map': [location: LocationData]
}>()

const { t } = useT()

// Toggle location selection
function toggleLocation(locationId: string) {
  const current = [...props.selectedLocations]
  const index = current.indexOf(locationId)
  if (index === -1) {
    current.push(locationId)
  } else {
    current.splice(index, 1)
  }
  emit('update:selectedLocations', current)
}

// Check if location is selected
function isLocationSelected(locationId: string): boolean {
  return props.selectedLocations.includes(locationId)
}

</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Section toggles + view controls -->
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide flex-nowrap md:flex-wrap">
        <!-- Section toggles -->
        <UButton
          size="sm"
          class="shrink-0"
          :color="showCalendar || hasSelectedDate ? 'primary' : 'neutral'"
          :variant="showCalendar ? 'solid' : 'outline'"
          icon="i-lucide-calendar"
          @click="emit('update:showCalendar', !showCalendar)"
        >
          {{ t('bookings.filters.calendar') }}
        </UButton>

        <UButton
          v-if="locations && locations.length > 0"
          size="sm"
          class="shrink-0"
          :color="showLocations || selectedLocations.length > 0 ? 'primary' : 'neutral'"
          :variant="showLocations ? 'solid' : 'outline'"
          icon="i-lucide-map-pin"
          @click="emit('update:showLocations', !showLocations)"
        >
          {{ t('bookings.filters.locations') }}
          <UBadge v-if="!showLocations && selectedLocations.length > 0" size="xs" color="primary" variant="solid" class="ml-0.5">
            {{ selectedLocations.length }}
          </UBadge>
        </UButton>

        <UButton
          v-if="hasLocationsWithCoordinates"
          size="sm"
          class="shrink-0"
          :color="showMap ? 'primary' : 'neutral'"
          :variant="showMap ? 'solid' : 'outline'"
          icon="i-lucide-map"
          @click="emit('update:showMap', !showMap)"
        >
          {{ t('bookings.filters.map') }}
        </UButton>

        <UButton
          size="sm"
          class="shrink-0"
          :color="showCancelled ? 'error' : 'neutral'"
          :variant="showCancelled ? 'solid' : 'outline'"
          icon="i-lucide-x-circle"
          @click="emit('update:showCancelled', !showCancelled)"
        >
          {{ t('bookings.filters.cancelled') }}
        </UButton>

      </div>

      <!-- View controls (only visible when calendar is shown) -->
      <div v-if="showCalendar" class="flex items-center gap-1 shrink-0">
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          @click="emit('go-to-today')"
        >
          {{ t('bookings.filters.today') }}
        </UButton>

        <UButton
          size="sm"
          :color="calendarView === 'week' ? 'primary' : 'neutral'"
          :variant="calendarView === 'week' ? 'solid' : 'outline'"
          @click="emit('update:calendarView', 'week')"
        >
          {{ t('bookings.filters.week') }}
        </UButton>

        <UButton
          size="sm"
          :color="calendarView === 'month' ? 'primary' : 'neutral'"
          :variant="calendarView === 'month' ? 'solid' : 'outline'"
          @click="emit('update:calendarView', 'month')"
        >
          {{ t('bookings.filters.month') }}
        </UButton>
      </div>
    </div>

    <!-- Empty state when no locations (admin only) -->
    <div
      v-if="locations.length === 0 && canManageLocations"
      class="flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-muted bg-muted/30"
    >
      <UIcon name="i-lucide-map-pin-off" class="w-5 h-5 text-muted flex-shrink-0" />
      <span class="text-sm text-muted">{{ t('bookings.panel.noLocations') }}</span>
      <UButton
        size="xs"
        variant="outline"
        icon="i-lucide-plus"
        @click="emit('add-location')"
      >
        {{ t('bookings.filters.addLocation') }}
      </UButton>
    </div>

    <!-- Location filter cards (collapsible) -->
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 max-h-0"
      enter-to-class="opacity-100 max-h-[200px]"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="opacity-100 max-h-[200px]"
      leave-to-class="opacity-0 max-h-0"
    >
      <div v-if="showLocations && locations && locations.length > 0" class="flex flex-wrap gap-2 overflow-hidden">
        <CroutonBookingsLocationCard
          v-for="location in locations"
          :key="location.id"
          :location="location"
          :selected="isLocationSelected(location.id)"
          :editable="canManageLocations"
          @click="toggleLocation(location.id)"
          @edit="emit('edit-location', $event)"
          @focus-on-map="emit('focus-on-map', $event)"
        />

        <!-- Add Location button (at end of location cards) -->
        <UButton
          v-if="canManageLocations"
          size="sm"
          variant="outline"
          icon="i-lucide-plus"
          class="self-center"
          @click="emit('add-location')"
        >
          {{ t('bookings.filters.addLocation') }}
        </UButton>
      </div>
    </Transition>
  </div>
</template>
