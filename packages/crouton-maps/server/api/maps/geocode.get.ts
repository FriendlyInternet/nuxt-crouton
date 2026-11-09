import { allowGeocodeCall } from '../../utils/geocodeRateLimit'

/**
 * GET /api/maps/geocode
 *
 * Server-side proxy for the Nominatim (OpenStreetMap) Geocoding API.
 * Nominatim is keyless, so no token is required. The base URL is read from
 * private runtimeConfig (`maps.geocodingUrl`) so it can point at a self-hosted
 * instance to avoid the public server's usage policy / rate limits.
 *
 * The Nominatim response is normalised into the Mapbox-style `{ features: [...] }`
 * shape the client (`useGeocode`) already expects, so no client change is needed.
 *
 * Query params:
 *   q       - Forward geocoding: address query string
 *   lng,lat - Reverse geocoding: coordinate pair (both required together)
 */

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  name?: string
  address?: {
    road?: string
    house_number?: string
    postcode?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    state?: string
    region?: string
    country?: string
  }
}

interface NormalizedFeature {
  center: [number, number]
  place_name: string
  text: string
  context: Array<{ id: string; text: string }>
}

function toFeature(r: NominatimResult): NormalizedFeature {
  const lng = Number(r.lon)
  const lat = Number(r.lat)
  const addr = r.address ?? {}

  const context: Array<{ id: string; text: string }> = []
  if (addr.postcode) context.push({ id: `postcode.${addr.postcode}`, text: addr.postcode })
  const place = addr.city || addr.town || addr.village || addr.municipality
  if (place) context.push({ id: `place.${place}`, text: place })
  const region = addr.state || addr.region
  if (region) context.push({ id: `region.${region}`, text: region })
  if (addr.country) context.push({ id: `country.${addr.country}`, text: addr.country })

  return {
    center: [lng, lat],
    place_name: r.display_name,
    text: r.name || addr.road || r.display_name.split(',')[0]?.trim() || r.display_name,
    context
  }
}

export default defineEventHandler(async (event) => {
  // Authenticated callers only: this proxies to a third-party geocoder.
  const user = await requireAuth(event)
  if (!allowGeocodeCall(user.id)) {
    throw createError({ status: 429, statusText: 'Too many geocoding requests' })
  }

  const config = useRuntimeConfig(event)
  const baseUrl = ((config as any).maps?.geocodingUrl as string | undefined)
    || 'https://nominatim.openstreetmap.org'

  const query = getQuery(event)
  const q = query.q as string | undefined
  const lngParam = query.lng as string | undefined
  const latParam = query.lat as string | undefined

  let endpoint: string
  let params: Record<string, string>

  if (q) {
    // Forward geocoding: address → coordinates
    endpoint = `${baseUrl}/search`
    params = { q, format: 'jsonv2', addressdetails: '1', limit: '5' }
  } else if (lngParam && latParam) {
    // Reverse geocoding: coordinates → address
    const lng = Number(lngParam)
    const lat = Number(latParam)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw createError({ status: 400, statusText: 'Invalid coordinates' })
    }
    endpoint = `${baseUrl}/reverse`
    params = { lon: String(lng), lat: String(lat), format: 'jsonv2', addressdetails: '1' }
  } else {
    throw createError({ status: 400, statusText: 'Provide either q (query) or lng+lat parameters' })
  }

  try {
    // Nominatim's usage policy requires an identifying User-Agent.
    const response = await $fetch<NominatimResult | NominatimResult[] | { error: unknown }>(endpoint, {
      query: params,
      headers: {
        'User-Agent': 'nuxt-crouton-maps (https://github.com/FriendlyInternet/nuxt-crouton)',
        'Accept-Language': 'en'
      }
    })

    // Forward search returns an array; reverse returns a single object.
    const results = Array.isArray(response)
      ? response
      : ('error' in (response as object)) ? [] : [response as NominatimResult]

    return { features: results.map(toFeature) }
  } catch (err: unknown) {
    const e = err as any
    console.error('[crouton-maps] Geocoding failed:', e?.data || e?.message || e)
    throw createError({
      status: 502,
      statusText: `Geocoding request failed: ${e?.data?.message || e?.message || 'unknown error'}`
    })
  }
})
