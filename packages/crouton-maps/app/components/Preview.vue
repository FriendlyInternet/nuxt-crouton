<template>
  <div class="flex justify-between items-center border rounded-md p-1 gap-1">
    <div class="h-10 w-40 overflow-hidden relative bg-neutral">
      <CroutonMapsMap
        v-if="coordinates"
        :id="`preview-map-${Math.random()}`"
        :center="coordinates"
        :zoom="13"
        height="40px"
        width="160px"
        :fly-to-on-center-change="false"
        class="preview-map"
      >
        <template #default="{ map }">
          <CroutonMapsMarker
            v-if="map"
            :map="map as any"
            :position="coordinates"
            :color="markerColor"
          />
        </template>
      </CroutonMapsMap>
      <div
        v-else
        class="flex items-center justify-center h-full text-xs text-gray-400"
      >
        {{ t('maps.preview.noLocation') }}
      </div>
    </div>

    <UModal :title="t('maps.preview.title')">
      <UButton
        icon="i-lucide-eye"
        size="xs"
        color="neutral"
        variant="ghost"
      />
      <template #body>
        <div class="h-96 w-full rounded overflow-hidden">
          <CroutonMapsMap
            v-if="coordinates"
            :center="coordinates"
            :zoom="15"
            height="50vh"
            width="100%"
            :fly-to-on-center-change="true"
          >
            <template #default="{ map }">
              <CroutonMapsMarker
                v-if="map"
                :map="map as any"
                :position="coordinates"
                :color="markerColor"
                :popup-text="`${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`"
              />
            </template>
          </CroutonMapsMap>
        </div>
        <div
          v-if="coordinates"
          class="mt-4 text-sm text-gray-600"
        >
          <p><strong>{{ t('maps.preview.coordinates') }}</strong></p>
          <p>{{ t('maps.preview.latitude', { value: coordinates[1].toFixed(6) }) }}</p>
          <p>{{ t('maps.preview.longitude', { value: coordinates[0].toFixed(6) }) }}</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  location?: string | [number, number]
}>()

const { t } = useT()
const markerColor = useMarkerColor()

// Parse coordinates from string or array
const coordinates = computed<[number, number] | null>(() => {
  if (!props.location) return null

  // If already an array
  if (Array.isArray(props.location) && props.location.length === 2) {
    return [props.location[0], props.location[1]]
  }

  // If string, try to parse as JSON
  if (typeof props.location === 'string') {
    try {
      const parsed = JSON.parse(props.location)
      if (Array.isArray(parsed) && parsed.length === 2) {
        return [parsed[0], parsed[1]]
      }
    } catch (e) {
      console.error('Failed to parse location:', e)
    }
  }

  return null
})
</script>

<style scoped>
/* Scale down the marker in preview mode */
.preview-map :deep(.maplibregl-marker) {
  width: 20px !important;
  height: 28px !important;
}

.preview-map :deep(.maplibregl-marker svg) {
  width: 20px !important;
  height: 28px !important;
}
</style>
