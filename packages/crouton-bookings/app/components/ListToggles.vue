<script setup lang="ts">
// The Show cancelled / Map text toggles the bookings list shows in the Panel, and PanelFilters shows (Show cancelled only) on composed pages (#4492, #4562)
interface Props {
  /** Whether cancelled bookings are shown */
  showCancelled: boolean
  /** Whether the map is shown */
  showMap: boolean
  /** Whether a location has coordinates (shows the Map toggle) */
  canShowMap: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'update:showCancelled': [value: boolean]
  'update:showMap': [value: boolean]
}>()

const { t } = useT()
</script>

<template>
  <div class="flex items-center gap-1 shrink-0">
    <UButton
      size="xs"
      icon="i-lucide-x-circle"
      :color="showCancelled ? 'primary' : 'neutral'"
      :variant="showCancelled ? 'soft' : 'ghost'"
      :aria-pressed="showCancelled"
      @click="emit('update:showCancelled', !showCancelled)"
    >
      {{ t('bookings.filters.cancelled') }}
    </UButton>
    <UButton
      v-if="canShowMap"
      size="xs"
      icon="i-lucide-map"
      :color="showMap ? 'primary' : 'neutral'"
      :variant="showMap ? 'soft' : 'ghost'"
      :aria-pressed="showMap"
      @click="emit('update:showMap', !showMap)"
    >
      {{ t('bookings.filters.map') }}
    </UButton>
  </div>
</template>
