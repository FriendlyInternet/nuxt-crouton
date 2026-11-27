<script setup lang="ts">
import type { LocationData } from '../types/booking'

interface Props {
  locations: LocationData[]
  /** Selected location IDs for filtering */
  selectedLocations: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-location': [locationId: string]
  'ready': []
}>()

const { t } = useI18n()

// Get localized location title with fallbacks
function getLocationTitle(location: LocationData): string {
  const { locale } = useI18n()
  const translations = location.translations as Record<string, { title?: string }> | undefined

  return translations?.[locale.value]?.title
    || translations?.en?.title
    || location.title
    || t('bookings.untitled')
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

// Get locations with valid coordinates for the map
const locationsWithCoordinates = computed(() => {
  return props.locations
    .map(location => ({
      ...location,
      coordinates: parseLocationCoordinates(location),
    }))
    .filter(loc => loc.coordinates !== null) as Array<LocationData & { coordinates: [number, number] }>
})

// Calculate map center from all locations with coordinates
const mapCenter = computed<[number, number]>(() => {
  const locs = locationsWithCoordinates.value
  if (locs.length === 0) return [4.9041, 52.3676] // Default to Amsterdam

  const sumLng = locs.reduce((sum, loc) => sum + loc.coordinates[0], 0)
  const sumLat = locs.reduce((sum, loc) => sum + loc.coordinates[1], 0)

  return [sumLng / locs.length, sumLat / locs.length]
})

// Check if location is selected
function isLocationSelected(locationId: string): boolean {
  return props.selectedLocations.includes(locationId)
}

// Handle marker click
function onMarkerClick(locationId: string) {
  emit('toggle-location', locationId)
}

function onMapLoad() {
  emit('ready')
}
</script>

<template>
  <div class="overflow-hidden rounded-lg h-[180px] md:h-[250px]">
    <CroutonMapsMap
      :center="mapCenter"
      :zoom="12"
      height="100%"
      fly-to-on-center-change
      @load="onMapLoad"
    >
      <template #default="{ map }">
        <CroutonMapsMarker
          v-for="location in locationsWithCoordinates"
          :key="location.id"
          :map="(map as any)"
          :position="location.coordinates"
          :color="location.color || '#3b82f6'"
          :active="selectedLocations.length > 0 ? isLocationSelected(location.id) : undefined"
          :popup-content="`<div class='p-2'><strong>${getLocationTitle(location)}</strong>${location.city ? `<br><span style='opacity: 0.7; font-size: 0.875rem;'>${location.city}</span>` : ''}</div>`"
          @click="onMarkerClick(location.id)"
        />
      </template>
    </CroutonMapsMap>
  </div>
</template>
