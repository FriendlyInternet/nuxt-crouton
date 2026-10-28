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

const hasActiveFilter = computed(() => props.selectedLocations.length > 0 || props.showCancelled)

const keepOpen = (e: Event) => e.preventDefault()

const settingsItems = computed(() => {
  const locationItems = (props.locations ?? []).map(location => ({
    type: 'checkbox' as const,
    label: location.title,
    checked: isLocationSelected(location.id),
    onUpdateChecked: () => toggleLocation(location.id),
    onSelect: keepOpen,
  }))
  const viewItems = [
    ...(props.hasLocationsWithCoordinates
      ? [{
          type: 'checkbox' as const,
          label: t('bookings.filters.map'),
          icon: 'i-lucide-map',
          checked: props.showMap,
          onUpdateChecked: (v: boolean) => emit('update:showMap', v),
          onSelect: keepOpen,
        }]
      : []),
    {
      type: 'checkbox' as const,
      label: t('bookings.filters.cancelled'),
      icon: 'i-lucide-x-circle',
      checked: props.showCancelled,
      onUpdateChecked: (v: boolean) => emit('update:showCancelled', v),
      onSelect: keepOpen,
    },
    ...(locationItems.length > 0
      ? [{
          type: 'checkbox' as const,
          label: t('bookings.filters.locationCards'),
          icon: 'i-lucide-map-pin',
          checked: props.showLocations,
          onUpdateChecked: (v: boolean) => emit('update:showLocations', v),
          onSelect: keepOpen,
        }]
      : []),
  ]
  return [
    ...(locationItems.length > 0
      ? [[{ type: 'label' as const, label: t('bookings.filters.locations') }, ...locationItems]]
      : []),
    [{ type: 'label' as const, label: t('bookings.filters.view') }, ...viewItems],
  ]
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- One short row: Week|Month · Today · settings · fold -->
    <div class="flex items-center justify-between gap-2">
      <UFieldGroup v-if="showCalendar" size="sm">
        <UButton
          :color="calendarView === 'week' ? 'primary' : 'neutral'"
          :variant="calendarView === 'week' ? 'solid' : 'outline'"
          @click="emit('update:calendarView', 'week')"
        >
          {{ t('bookings.filters.week') }}
        </UButton>
        <UButton
          :color="calendarView === 'month' ? 'primary' : 'neutral'"
          :variant="calendarView === 'month' ? 'solid' : 'outline'"
          @click="emit('update:calendarView', 'month')"
        >
          {{ t('bookings.filters.month') }}
        </UButton>
      </UFieldGroup>
      <div class="flex items-center gap-1 shrink-0 ms-auto">
        <UButton
          v-if="showCalendar"
          size="sm"
          color="neutral"
          variant="soft"
          @click="emit('go-to-today')"
        >
          {{ t('bookings.filters.today') }}
        </UButton>

        <UDropdownMenu :items="settingsItems">
          <UChip :show="hasActiveFilter" color="primary" size="md">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-settings"
              :aria-label="t('bookings.filters.settings')"
            />
          </UChip>
        </UDropdownMenu>

        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          :icon="showCalendar ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          :aria-label="showCalendar ? t('bookings.filters.foldCalendar') : t('bookings.filters.unfoldCalendar')"
          :aria-expanded="showCalendar"
          @click="emit('update:showCalendar', !showCalendar)"
        />
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
