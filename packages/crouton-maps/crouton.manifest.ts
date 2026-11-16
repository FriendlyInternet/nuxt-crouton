import { defineCroutonManifest, defineGeneratorContribution } from '@fyit/crouton-core/shared/manifest'

export default defineCroutonManifest({
  id: 'crouton-maps',
  name: 'Maps',
  description: 'MapLibre GL integration (@geoql/v-maplibre) with map components, markers, Nominatim geocoding, and OpenFreeMap style presets — no API key required. Used by crouton-bookings for location maps.',
  icon: 'i-lucide-map',
  version: '0.1.0',
  category: 'addon',
  aiHint: 'use when app has location features or map displays',

  layer: {
    name: 'maps',
    editable: false,
    reason: 'No database tables — provides components and composables only.'
  },

  dependencies: [],

  // No collections — this is a UI/composable-only package
  collections: [],

  runtimeConfigKey: 'maps',

  configuration: {
    'style': {
      runtimeConfig: 'public',
      type: 'select',
      label: 'Default Map Style',
      description: 'Default OpenFreeMap style for all maps. Keyless — no token required. Can be overridden per component or via MAPS_STYLE env var.',
      default: 'liberty',
      options: [
        { value: 'liberty', label: 'Liberty (default)' },
        { value: 'positron', label: 'Positron (light)' },
        { value: 'bright', label: 'Bright' },
        { value: 'dark', label: 'Dark' },
        { value: 'fiord', label: 'Fiord (muted)' }
      ]
    },
    'geocodingUrl': {
      runtimeConfig: 'server',
      type: 'string',
      label: 'Nominatim URL',
      description: 'Base URL for the Nominatim geocoding server. Set via NOMINATIM_URL env var. Defaults to the public OpenStreetMap instance; point at a self-hosted instance to avoid rate limits.',
      default: 'https://nominatim.openstreetmap.org'
    }
  },

  extensionPoints: [],

  provides: {
    composables: [
      'useGeocode',
      'useMapConfig',
      'useMarkerColor',
      'useMapStyles',
      'useCurrentLocation'
    ],
    components: [
      // Component prefix is 'CroutonMaps' — Map.vue → CroutonMapsMap, etc.
      { name: 'CroutonMapsMap', description: 'Main map container with MapLibre GL (@geoql/v-maplibre, OpenFreeMap tiles)', props: ['center', 'zoom', 'style', 'height', 'flyToOnCenterChange'] },
      { name: 'CroutonMapsMarker', description: 'Map marker with optional popup text and drag support', props: ['map', 'position', 'color', 'options', 'popupText', 'animateTransitions'] },
      { name: 'CroutonMapsPopup', description: 'Map popup with custom slot content', props: ['map', 'position'] },
      { name: 'CroutonMapsPreview', description: 'Location preview thumbnail with modal — used in collection list cells', props: ['location'] }
    ],
    apiRoutes: [
      '/api/maps/geocode',
    ],
    editorBlocks: [
      { type: 'mapBlock', name: 'Map', description: 'Embed an interactive map with a location pin', icon: 'i-lucide-map-pin', category: 'content' },
      { type: 'collectionMapBlock', name: 'Collection Map', description: 'Show collection items as markers on an interactive map', icon: 'i-lucide-map', category: 'content' }
    ],
  },

  // Detection patterns — what schema fields trigger map/geocoding generation
  detects: {
    fieldNamePatterns: [
      'street', 'address', 'city', 'town', 'zip', 'zipcode',
      'postal', 'postalcode', 'postcode', 'country', 'state', 'province', 'region'
    ],
    coordinatePatterns: [
      'location', 'coordinates', 'coords', 'lat', 'latitude',
      'lng', 'lon', 'longitude', 'geocoordinates', 'latlng', 'lnglat'
    ],
  }
})

// ---------------------------------------------------------------------------
// Generator contribution — owns the map/geocoding form and list enhancements
// ---------------------------------------------------------------------------

export const generatorContribution = defineGeneratorContribution({
  enhanceForm(ctx) {
    const { detected } = ctx
    const { addressFields, coordinateField, hasAddress } = detected

    // Skip FK fields — a `refTarget` coordinate match (e.g. `locationId`) is a
    // reference, not a geo field, so no map picker should be injected.
    if (!hasAddress || !coordinateField || coordinateField.refTarget) return null

    const coordinateFieldName = coordinateField.name

    // Determine which group to inject the map into
    // If coordinate field has a group (e.g. 'map'), use that — otherwise fall back to 'address'
    const coordGroup = (coordinateField.meta?.group as string) || 'address'

    const mapSection = `
       <!-- MapLibre Map Display -->
      <UFormField label="Location Map" name="${coordinateFieldName}" class="not-last:pb-4">
        <CroutonMapsMap
          :center="mapCenter"
          :zoom="14"
          height="400px"
          class="rounded-lg border"
          :fly-to-on-center-change="true"
          @load="handleMapLoad"
        >
          <template #default="{ map }">
            <CroutonMapsMarker
              v-if="mapCenter[0] !== 0 || mapCenter[1] !== 0"
              :map="map as any"
              :position="mapCenter"
              :color="markerColor"
              :options="{ draggable: true }"
              :animate-transitions="true"
              @dragEnd="handleMarkerDragEnd"
            />
          </template>
        </CroutonMapsMap>
        <p v-if="geocoding" class="text-sm text-gray-500 mt-2">
          Geocoding address...
        </p>
      </UFormField>`

    const scriptCode = `
// Map & Geocoding functionality
const { geocode, loading: geocoding } = useGeocode()

// Parse existing coordinates from location field (handle both array and string formats)
const parseCoordinates = (value: any): [number, number] | null => {
  if (!value) return null
  if (Array.isArray(value) && value.length === 2) {
    return [Number(value[0]), Number(value[1])]
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed) && parsed.length === 2) {
        return [Number(parsed[0]), Number(parsed[1])]
      }
    } catch {
      return null
    }
  }
  return null
}

const initialCoordinates = parseCoordinates(state.value.${coordinateFieldName})
const mapCenter = ref<[number, number]>(initialCoordinates || [0, 0])
const mapInstance = ref<any>(null)

const markerColor = useMarkerColor()

// Store map instance when loaded
const handleMapLoad = (map: any) => {
  mapInstance.value = map
}

// Auto-geocode when address fields change
watchDebounced(
  () => [${addressFields.map((f: any) => `state.value.${f.name}`).join(', ')}],
  async () => {
    if (canGeocode.value) {
      await handleGeocode()
    }
  },
  { debounce: 1000, maxWait: 3000 }
)

// Check if we have enough address data to geocode
const canGeocode = computed(() => {
  return ${addressFields.map((f: any) => `!!state.value.${f.name}`).slice(0, 2).join(' || ')}
})

// Handle geocoding of address fields
const handleGeocode = async () => {
  try {
    const addressParts: string[] = []
    ${addressFields.map((f: any) => `if (state.value.${f.name}) addressParts.push(state.value.${f.name} as string)`).join('\n    ')}

    const addressQuery = addressParts.join(', ')
    if (!addressQuery.trim()) return

    const result = await geocode(addressQuery)
    if (result) {
      mapCenter.value = result.coordinates

      // Update the coordinate field in the form state (store as JSON string)
      state.value.${coordinateFieldName} = JSON.stringify(result.coordinates)
    }
  } catch (error) {
    console.error('Geocoding failed:', error)
  }
}

// Handle marker drag to update coordinates
const handleMarkerDragEnd = (position: { lng: number; lat: number }) => {
  mapCenter.value = [position.lng, position.lat]
  state.value.${coordinateFieldName} = JSON.stringify([position.lng, position.lat])
}`

    return {
      excludeFieldNames: [coordinateFieldName],
      groupInjections: { [coordGroup]: mapSection },
      scriptCode,
    }
  },

  enhanceList(ctx) {
    const { detected } = ctx
    const { coordinateField, hasAddress } = detected

    // A foreign-key field (refTarget) is never geo coordinates — e.g. a `locationId`
    // FK matches the 'location' pattern but is a reference, not a map field. Skipping
    // it avoids a duplicate cell slot (the reference cell already renders it).
    if (!hasAddress || !coordinateField || coordinateField.refTarget) return null

    const coordinateFieldName = coordinateField.name

    return {
      cellTemplates: {
        [coordinateFieldName]: `
    <template #${coordinateFieldName}-cell="{ row }">
      <CroutonMapsPreview :location="row.original.${coordinateFieldName}" />
    </template>`,
      },
    }
  },
})
