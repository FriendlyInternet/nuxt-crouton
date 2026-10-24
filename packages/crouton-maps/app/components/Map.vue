<script setup lang="ts">
import { VMap } from '@geoql/v-maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@geoql/v-maplibre/style.css'
import { getWorkerUrl, setWorkerUrl } from 'maplibre-gl'
import type { LngLatLike, Map as MaplibreMap } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

// @geoql/v-maplibre ships its own prebuilt worker (v3.0.1 → maplibre 6.10.0) and
// installs it unless a worker URL is already set. A worker from a different
// maplibre version than the main thread fails every vector tile ("Cannot read
// properties of undefined (reading 'width')"), so point maplibre at the worker
// from the SAME maplibre-gl we load. (#2291)
if (import.meta.client && !getWorkerUrl()) setWorkerUrl(maplibreWorkerUrl)

interface Props {
  /** Map container ID (default: auto-generated) — must be unique per map */
  id?: string
  /** Initial center coordinates [lng, lat] */
  center?: LngLatLike
  /** Initial zoom level */
  zoom?: number
  /** Style preset name (e.g. 'dark') or full MapLibre style URL */
  style?: string
  /** Container height (CSS value) */
  height?: string
  /** Container width (CSS value) */
  width?: string
  /** Additional CSS classes */
  class?: string
  /** Enable smooth flyTo animation when center changes (default: false) */
  flyToOnCenterChange?: boolean
  /** FlyTo animation duration in milliseconds (default: 800) */
  flyToDuration?: number
  /** FlyTo easing function (default: easeInOutCubic) */
  flyToEasing?: (t: number) => number
}

const props = withDefaults(defineProps<Props>(), {
  id: () => `map-${Math.random().toString(36).substr(2, 9)}`,
  height: '400px',
  width: '100%'
})

const emit = defineEmits<{
  load: [map: MaplibreMap]
  error: [error: string]
}>()

// Get map config (style/center/zoom defaults)
const config = useMapConfig()
const { t } = useT()

// Dark mode detection — auto-switch map style
const colorMode = useColorMode()
const autoStyle = computed(() => {
  // Explicit style prop wins — resolve preset names to URLs
  if (props.style) return getMapStyle(props.style)
  // Otherwise pick light/dark based on color mode
  return colorMode.value === 'dark'
    ? MAP_STYLES.dark
    : (config.style || MAP_STYLES.liberty)
})

// Map state
const mapInstance = ref<MaplibreMap | null>(null)
const isLoaded = ref(false)
const error = ref<string | null>(null)

// Options passed to VMap (maplibre MapOptions). VMap renders a <div :id="container">
// and mounts the map there, so `container` must match a unique id.
const mapOptions = computed(() => ({
  container: props.id,
  style: autoStyle.value,
  center: (props.center || config.center || [4.9041, 52.3676]) as LngLatLike,
  zoom: props.zoom || config.zoom || 12
}))

// Handle map load (VMap emits `loaded` with the maplibre Map instance)
const handleMapLoad = (map: MaplibreMap) => {
  mapInstance.value = map
  isLoaded.value = true
  error.value = null
  // The center watcher ignores changes until the map is loaded, so a center
  // that arrived while loading (e.g. an async geocode) would be lost — sync it.
  if (props.center) map.jumpTo({ center: props.center })
  emit('load', map)
}

// Handle map error
const handleMapError = (err: Error | { message?: string } | unknown) => {
  const errorMessage = (err as { message?: string })?.message || t('maps.loadFailed')
  error.value = errorMessage
  isLoaded.value = false
  emit('error', errorMessage)
}

// Default easing function for flyTo
const defaultEasing = (x: number): number => {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

// Watch for style changes (e.g. dark mode toggle) and update the map
watch(autoStyle, (newStyle) => {
  if (mapInstance.value && isLoaded.value) {
    mapInstance.value.setStyle(newStyle)
  }
})

// Watch for center changes and optionally animate with flyTo
watch(() => props.center, (newCenter, oldCenter) => {
  if (!props.flyToOnCenterChange || !mapInstance.value || !isLoaded.value) return
  if (!newCenter || !oldCenter) return

  const getCoords = (center: LngLatLike): [number, number] => {
    if (Array.isArray(center)) return center as [number, number]
    if ('lng' in center) return [center.lng, center.lat]
    return [(center as { lon: number; lat: number }).lon, center.lat]
  }

  const oldCoords = getCoords(oldCenter)
  const newCoords = getCoords(newCenter)
  if (oldCoords[0] === newCoords[0] && oldCoords[1] === newCoords[1]) return

  mapInstance.value.flyTo({
    center: newCenter,
    duration: props.flyToDuration ?? 800,
    essential: true,
    easing: props.flyToEasing || defaultEasing
  })
})

// Expose map instance and state
defineExpose({
  map: mapInstance,
  isLoaded,
  error
})
</script>

<template>
  <div
    class="crouton-map-wrapper"
    :class="props.class"
  >
    <ClientOnly>
      <!-- MapLibre map via @geoql/v-maplibre -->
      <VMap
        :options="mapOptions"
        :style="{ height: props.height, width: props.width }"
        @loaded="handleMapLoad"
        @error="handleMapError"
      >
        <!-- Pass through default slot for markers, popups, etc. -->
        <slot
          v-if="isLoaded && mapInstance"
          :map="mapInstance"
        />
      </VMap>

      <!-- Loading state (client-side while map loads) -->
      <div
        v-if="!isLoaded && !error"
        class="crouton-map-loading"
      >
        <div class="crouton-map-spinner">
          <svg
            class="animate-spin h-8 w-8 text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      </div>

      <!-- Error state -->
      <div
        v-if="error"
        class="crouton-map-error"
      >
        <div class="crouton-map-error-content">
          <svg
            class="h-8 w-8 text-error"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fill-rule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clip-rule="evenodd"
            />
          </svg>
          <p class="mt-2 text-sm text-gray-600">
            {{ error }}
          </p>
        </div>
      </div>

      <!-- SSR fallback: loading spinner (not absolute positioned) -->
      <template #fallback>
        <div
          class="crouton-map-fallback"
          :style="{ height: props.height, width: props.width }"
        >
          <div class="crouton-map-spinner">
            <svg
              class="animate-spin h-8 w-8 text-primary"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        </div>
      </template>
    </ClientOnly>
  </div>
</template>

<style scoped>
.crouton-map-wrapper {
  position: relative;
  overflow: hidden;
  border-radius: 0.5rem;
}

.crouton-map-loading,
.crouton-map-error {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
  z-index: 1000;
}

:root.dark .crouton-map-loading,
:root.dark .crouton-map-error {
  background: rgba(0, 0, 0, 0.9);
}

.crouton-map-error-content {
  text-align: center;
  padding: 1rem;
}

/* SSR fallback - not absolute positioned so it takes up space */
.crouton-map-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.9);
}

:root.dark .crouton-map-fallback {
  background: rgba(0, 0, 0, 0.9);
}
</style>

<!-- Global styles for MapLibre popups (not scoped to allow dark mode support) -->
<style>
/* Dark mode popup styles using Nuxt UI CSS variables */
.dark .maplibregl-popup-content {
  background-color: var(--ui-bg-elevated);
  color: var(--ui-text);
  border-radius: 0.5rem;
  box-shadow: var(--ui-shadow-lg);
}

.dark .maplibregl-popup-tip {
  border-top-color: var(--ui-bg-elevated);
  border-bottom-color: var(--ui-bg-elevated);
}

/* Also handle anchor positions */
.dark .maplibregl-popup-anchor-top .maplibregl-popup-tip {
  border-bottom-color: var(--ui-bg-elevated);
}

.dark .maplibregl-popup-anchor-bottom .maplibregl-popup-tip {
  border-top-color: var(--ui-bg-elevated);
}

.dark .maplibregl-popup-anchor-left .maplibregl-popup-tip {
  border-right-color: var(--ui-bg-elevated);
}

.dark .maplibregl-popup-anchor-right .maplibregl-popup-tip {
  border-left-color: var(--ui-bg-elevated);
}

/* Close button in dark mode */
.dark .maplibregl-popup-close-button {
  color: var(--ui-text-muted);
}

.dark .maplibregl-popup-close-button:hover {
  color: var(--ui-text);
  background-color: var(--ui-bg-accented);
}
</style>
