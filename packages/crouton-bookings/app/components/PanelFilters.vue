<script setup lang="ts">
import type { LocationData } from '../types/booking'
import { locationsFor, tabValueFor } from '../utils/location-tabs'

interface Props {
  locations: LocationData[]
  /** Selected location IDs */
  selectedLocations: string[]
  /** Whether to show cancelled bookings */
  showCancelled?: boolean
  /** Whether user can manage locations (admin) */
  canManageLocations?: boolean
  /** Panel mode (default): only the admin "no locations yet" prompt renders — the Panel shows the month label, the close X and the fold handle itself (#4516). Off on composed pages, where this renders the Show cancelled text toggle (the same `ListToggles` the Panel's list uses, #4562) and the location tab row itself (#4471, #4492). */
  viewToggles?: boolean
}

withDefaults(defineProps<Props>(), {
  showCancelled: false,
  viewToggles: true,
  canManageLocations: false,
})

const emit = defineEmits<{
  'update:selectedLocations': [value: string[]]
  'update:showCancelled': [value: boolean]
  'add-location': []
}>()

const { t } = useT()
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Composed pages only: the Show cancelled text toggle row (the Panel has no toolbar row, #4516) -->
    <div v-if="!viewToggles" class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1 shrink-0 ms-auto">
        <CroutonBookingsListToggles
          :show-cancelled="showCancelled"
          :show-map="false"
          :can-show-map="false"
          @update:show-cancelled="emit('update:showCancelled', $event)"
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

    <!-- Location tab row on composed pages; the Panel renders its own above the calendar (#4471, #4516) -->
    <CroutonBookingsLocationTabs
      v-if="!viewToggles && locations.length > 0"
      :locations="locations"
      :model-value="tabValueFor(selectedLocations)"
      show-all
      :can-add="canManageLocations"
      @update:model-value="emit('update:selectedLocations', locationsFor($event))"
      @add="emit('add-location')"
    />
  </div>
</template>
