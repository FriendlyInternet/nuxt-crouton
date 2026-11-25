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
  /** Panel mode (default): only the admin "no locations yet" prompt renders — the Panel shows the month label, the close X and the fold handle itself (#4516). Off on composed pages, where this renders the cog (Show cancelled) and the location tab row itself (#4471, #4492). */
  viewToggles?: boolean
}

const props = withDefaults(defineProps<Props>(), {
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

const hasActiveFilter = computed(() => props.selectedLocations.length > 0 || props.showCancelled)

const keepOpen = (e: Event) => e.preventDefault()

// Only rendered on composed pages (!viewToggles); in the Panel, Show cancelled and Map live on the list (#4492)
const settingsItems = computed(() => [
  [
    { type: 'label' as const, label: t('bookings.filters.view') },
    {
      type: 'checkbox' as const,
      label: t('bookings.filters.cancelled'),
      icon: 'i-lucide-x-circle',
      checked: props.showCancelled,
      onUpdateChecked: (v: boolean) => emit('update:showCancelled', v),
      onSelect: keepOpen,
    },
  ],
])
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- Composed pages only: the settings cog row (the Panel has no toolbar row, #4516) -->
    <div v-if="!viewToggles" class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1 shrink-0 ms-auto">
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

    <!-- Location tab row on composed pages; the Panel renders its own under the calendar (#4471) -->
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
