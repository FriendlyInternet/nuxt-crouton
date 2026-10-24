/**
 * Composable for geocoding addresses to coordinates
 *
 * Geocoding requests are proxied through /api/maps/geocode (server-side), which
 * calls Nominatim (OpenStreetMap). Keyless — no access token required. Proxying
 * server-side keeps the (optionally self-hosted) geocoder URL and User-Agent
 * policy in one place.
 *
 * Usage:
 * const { geocode, reverseGeocode, loading, error } = useGeocode()
 *
 * // Forward geocoding (address → coordinates)
 * const result = await geocode('1600 Amphitheatre Parkway, Mountain View, CA')
 * // { coordinates: [-122.0840575, 37.4220656], address: '...', ... }
 *
 * // Reverse geocoding (coordinates → address)
 * const result = await reverseGeocode([-122.0840575, 37.4220656])
 */

interface GeocodeFeature {
  center: [number, number]
  place_name: string
  text: string
  context?: Array<{ id: string; text: string }>
}

interface GeocodeApiResponse {
  features: GeocodeFeature[]
}

export interface GeocodeResult {
  coordinates: [number, number]
  address: string
  placeName: string
  context?: {
    postcode?: string
    place?: string
    region?: string
    country?: string
  }
}

export function useGeocode() {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const config = useMapConfig()
  const { t } = useT()

  /**
   * Forward geocoding: Convert address to coordinates
   * Proxied via /api/maps/geocode (Nominatim).
   */
  const geocode = async (query: string): Promise<GeocodeResult | null> => {
    if (!config.isConfigured) return null

    try {
      loading.value = true
      error.value = null

      // Call our server-side proxy (Nominatim)
      const response = await $fetch<GeocodeApiResponse>('/api/maps/geocode', {
        query: { q: query }
      })

      if (!response.features || response.features.length === 0) {
        error.value = t('maps.geocode.noResults')
        return null
      }

      const feature = response.features[0]!
      const [lng, lat] = feature.center

      return {
        coordinates: [lng, lat],
        address: feature.place_name,
        placeName: feature.text,
        context: extractContext(feature.context)
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('maps.geocode.failed')
      error.value = errorMessage
      console.error('[nuxt-crouton-maps] Geocoding error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * Reverse geocoding: Convert coordinates to address
   * Proxied via /api/maps/geocode (Nominatim).
   */
  const reverseGeocode = async (coordinates: [number, number]): Promise<GeocodeResult | null> => {
    if (!config.isConfigured) return null

    try {
      loading.value = true
      error.value = null

      const [lng, lat] = coordinates

      // Call our server-side proxy (Nominatim)
      const response = await $fetch<GeocodeApiResponse>('/api/maps/geocode', {
        query: { lng, lat }
      })

      if (!response.features || response.features.length === 0) {
        error.value = t('maps.geocode.noResults')
        return null
      }

      const feature = response.features[0]!

      return {
        coordinates,
        address: feature.place_name,
        placeName: feature.text,
        context: extractContext(feature.context)
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('maps.geocode.reverseFailed')
      error.value = errorMessage
      console.error('[nuxt-crouton-maps] Reverse geocoding error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    geocode,
    reverseGeocode,
    loading: readonly(loading),
    error: readonly(error)
  }
}

// Helper to extract context information
function extractContext(context?: Array<{ id: string; text: string }>): GeocodeResult['context'] {
  if (!context) return undefined

  const result: GeocodeResult['context'] = {}

  for (const item of context) {
    if (item.id.startsWith('postcode')) {
      result.postcode = item.text
    } else if (item.id.startsWith('place')) {
      result.place = item.text
    } else if (item.id.startsWith('region')) {
      result.region = item.text
    } else if (item.id.startsWith('country')) {
      result.country = item.text
    }
  }

  return result
}
