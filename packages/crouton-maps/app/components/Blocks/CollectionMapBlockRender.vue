<script setup lang="ts">
/**
 * Collection Map Block Public Renderer
 *
 * Renders collection items as markers on an interactive map.
 * Auto-detects coordinate fields from collection data and fits
 * bounds to show all markers.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 */

interface CollectionMapBlockAttrs {
  collection: string
  title?: string
  height: number
  zoom: number
  style: string
  coordinateField?: string
  labelField?: string
}

interface Props {
  attrs: CollectionMapBlockAttrs
}

const props = defineProps<Props>()

const { t } = useT()

// Get collection config to verify it exists
const { getConfig } = useCollections()
const collectionConfig = computed(() => {
  if (!props.attrs.collection) return null
  return getConfig(props.attrs.collection)
})

const styleUrl = computed(() => getMapStyle(props.attrs.style || 'liberty'))

// Parse numeric values (may come as strings from select schema)
const zoom = computed(() => {
  const v = props.attrs.zoom
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 12
})

const height = computed(() => {
  const v = props.attrs.height
  return typeof v === 'number' ? v : parseInt(String(v), 10) || 400
})

// Known coordinate field name patterns
const COORD_FIELD_PATTERNS = [
  'location', 'coordinates', 'coords', 'position',
  'latLng', 'latlng', 'geo', 'geopoint',
  'lat', 'latitude', 'lng', 'longitude'
]

function detectCoordinateField(item: Record<string, any>): string | null {
  for (const pattern of COORD_FIELD_PATTERNS) {
    for (const key of Object.keys(item)) {
      if (key.toLowerCase() === pattern.toLowerCase()) {
        const value = item[key]
        if (value && typeof value === 'object' && 'lat' in value && 'lng' in value) return key
        if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number') return key
        if (typeof value === 'string' && /^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(value.trim())) return key
      }
    }
  }
  return null
}

function extractCoords(value: any): [number, number] | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value) && 'lat' in value && 'lng' in value) {
    const lat = Number(value.lat)
    const lng = Number(value.lng)
    if (!isNaN(lat) && !isNaN(lng)) return [lng, lat]
  }
  if (Array.isArray(value) && value.length === 2) {
    const lng = Number(value[0])
    const lat = Number(value[1])
    if (!isNaN(lat) && !isNaN(lng)) return [lng, lat]
  }
  if (typeof value === 'string') {
    const parts = value.split(',').map(s => s.trim())
    if (parts.length === 2) {
      const lat = Number(parts[0])
      const lng = Number(parts[1])
      if (!isNaN(lat) && !isNaN(lng)) return [lng, lat]
    }
  }
  return null
}

// Reactive collection data
const items = ref<any[]>([])
const pending = ref(false)
const fetchError = ref<any>(null)

watch(
  () => props.attrs.collection,
  async (collectionName) => {
    if (!collectionName) {
      items.value = []
      pending.value = false
      return
    }

    pending.value = true
    fetchError.value = null

    try {
      const result = await useCollectionQuery(collectionName, {
        query: computed(() => ({
          pageSize: 500,
          sortBy: 'createdAt',
          sortDirection: 'desc'
        }))
      })
      items.value = result.items.value || []

      watch(result.items, (newItems) => {
        items.value = newItems || []
      })
    } catch (e) {
      console.error('[CollectionMapBlock] Failed to fetch collection:', e)
      fetchError.value = e
      items.value = []
    } finally {
      pending.value = false
    }
  },
  { immediate: true }
)

const coordinateField = computed(() => {
  if (props.attrs.coordinateField) return props.attrs.coordinateField
  if (!items.value.length) return null
  return detectCoordinateField(items.value[0])
})

const markers = computed(() => {
  if (!coordinateField.value || !items.value.length) return []

  return items.value
    .map(item => {
      const coords = extractCoords(item[coordinateField.value!])
      if (!coords) return null

      let label = ''
      if (props.attrs.labelField && item[props.attrs.labelField]) {
        label = String(item[props.attrs.labelField])
      } else if (item.title) {
        label = String(item.title)
      } else if (item.name) {
        label = String(item.name)
      }

      return {
        id: item.id || Math.random().toString(36).slice(2),
        position: coords as [number, number],
        label
      }
    })
    .filter(Boolean) as { id: string; position: [number, number]; label: string }[]
})

const defaultCenter = computed<[number, number]>(() => [0, 0])

const mapRef = ref<any>(null)

function fitBounds(map: any) {
  if (!map || markers.value.length === 0) return

  if (markers.value.length === 1) {
    map.flyTo({ center: markers.value[0]!.position, zoom: zoom.value })
    return
  }

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const marker of markers.value) {
    const [lng, lat] = marker.position
    if (lng < minLng) minLng = lng
    if (lat < minLat) minLat = lat
    if (lng > maxLng) maxLng = lng
    if (lat > maxLat) maxLat = lat
  }

  map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 15 })
}

function handleMapLoad(map: any) {
  mapRef.value = map
  fitBounds(map)
}

watch(markers, () => {
  if (mapRef.value) fitBounds(mapRef.value)
})
</script>

<template>
  <div class="collection-map-block">
    <h2 v-if="attrs.title" class="text-2xl font-bold mb-4">
      {{ attrs.title }}
    </h2>

    <!-- No collection selected -->
    <UAlert
      v-if="!attrs.collection"
      color="neutral"
      icon="i-lucide-database"
      :title="t('maps.collectionBlock.noCollection')"
      :description="t('maps.collectionBlock.noCollectionDescription')"
    />

    <!-- Collection not found -->
    <UAlert
      v-else-if="!collectionConfig"
      color="warning"
      icon="i-lucide-alert-triangle"
      :title="t('maps.collectionBlock.notFound', { collection: attrs.collection })"
    />

    <!-- Loading state -->
    <div
      v-else-if="pending"
      class="flex items-center justify-center rounded-lg bg-muted/30"
      :style="{ height: `${height}px` }"
    >
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
    </div>

    <!-- No coordinate field detected -->
    <UAlert
      v-else-if="!coordinateField"
      color="neutral"
      icon="i-lucide-map-pin-off"
      :title="t('maps.collectionBlock.noCoordinates')"
      :description="t('maps.collectionBlock.noCoordinatesDescription')"
    />

    <!-- No items with valid coordinates -->
    <UAlert
      v-else-if="markers.length === 0"
      color="neutral"
      icon="i-lucide-map-pin"
      :title="t('maps.collectionBlock.noMarkers')"
      :description="t('maps.collectionBlock.noMarkersDescription')"
    />

    <!-- Render map with markers -->
    <CroutonMapsMap
      v-else
      :center="(markers.length === 1 ? markers[0]!.position : defaultCenter) as any"
      :zoom="zoom"
      :style="styleUrl"
      :height="`${height}px`"
      @load="handleMapLoad"
    >
      <template #default="{ map }">
        <template v-if="map">
          <CroutonMapsMarker
            v-for="marker in markers"
            :key="marker.id"
            :map="map as any"
            :position="marker.position"
            :popup-text="marker.label || undefined"
          />
        </template>
      </template>
    </CroutonMapsMap>
  </div>
</template>
