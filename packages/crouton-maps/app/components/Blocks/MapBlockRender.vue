<script setup lang="ts">
/**
 * Map Block Public Renderer
 *
 * Renders a map block in read-only mode using CroutonMapsMap.
 * Since this lives in crouton-maps, no hasApp() check is needed.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 */

interface MapBlockAttrs {
  address?: string
  lat: number
  lng: number
  zoom: number
  style: string
  height: number
  markerLabel?: string
}

interface Props {
  attrs: MapBlockAttrs
}

const props = defineProps<Props>()

const { t } = useT()

const styleUrl = computed(() => getMapStyle(props.attrs.style || 'liberty'))

// Parse numeric values (may come as strings from select schema)
const lat = computed(() => {
  const v = props.attrs.lat
  return typeof v === 'number' ? v : parseFloat(String(v)) || 0
})

const lng = computed(() => {
  const v = props.attrs.lng
  return typeof v === 'number' ? v : parseFloat(String(v)) || 0
})

const zoom = computed(() => {
  const v = props.attrs.zoom
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 12
})

const height = computed(() => {
  const v = props.attrs.height
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 400
})

const center = computed<[number, number]>(() => [lng.value, lat.value])

const hasLocation = computed(() => lat.value !== 0 || lng.value !== 0)
</script>

<template>
  <div class="map-block">
    <!-- No location set -->
    <UAlert
      v-if="!hasLocation"
      color="neutral"
      icon="i-lucide-map-pin"
      :title="t('maps.block.noLocation')"
      :description="t('maps.block.noLocationDescription')"
    />

    <!-- Render map -->
    <CroutonMapsMap
      v-else
      :center="center"
      :zoom="zoom"
      :style="styleUrl"
      :height="`${height}px`"
    >
      <template #default="{ map }">
        <CroutonMapsMarker
          v-if="map && attrs.markerLabel"
          :map="map as any"
          :position="center"
          :popup-text="attrs.markerLabel"
        />
        <CroutonMapsMarker
          v-else-if="map"
          :map="map as any"
          :position="center"
        />
      </template>
    </CroutonMapsMap>
  </div>
</template>
