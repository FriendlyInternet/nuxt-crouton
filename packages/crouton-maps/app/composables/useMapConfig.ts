import type { MapConfig } from '../types'
import { getMapStyle } from './useMapStyles'

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

/**
 * Access map configuration from public runtime config.
 *
 * Maps are keyless (OpenFreeMap tiles + Nominatim geocoding), so `isConfigured`
 * is always true — it remains in the return shape for backwards compatibility
 * with components that branched on it. There is always a usable default style.
 *
 * Usage:
 * const { style, center, zoom } = useMapConfig()
 */
export function useMapConfig(): MapConfig & { isConfigured: boolean } {
  const config = useRuntimeConfig()

  let mapsConfig: {
    style?: string
    center?: any
    zoom?: number
  } | undefined

  try {
    mapsConfig = config.public.maps as typeof mapsConfig
  } catch (_e) {
    // Config not available — fall through to defaults
  }

  return {
    isConfigured: true,
    // Accept a preset name ('positron') or a full style URL
    style: getMapStyle(mapsConfig?.style || DEFAULT_STYLE),
    center: mapsConfig?.center,
    zoom: mapsConfig?.zoom || 12
  }
}
