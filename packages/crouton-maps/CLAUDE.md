# CLAUDE.md - @fyit/crouton-maps

## Package Purpose

Map integration layer for Nuxt Crouton built on **MapLibre GL** via
[`@geoql/v-maplibre`](https://v-maplibre.geoql.in). Provides map components,
markers, geocoding composables, and style presets. **Keyless by default** —
base tiles come from [OpenFreeMap](https://openfreemap.org) and geocoding from
[Nominatim](https://nominatim.org) (OpenStreetMap), so no access token is needed.

## Key Files

| File | Purpose |
|------|---------|
| `crouton.manifest.ts` | Package manifest (components, composables, config) + form/list generator contribution |
| `nuxt.config.ts` | Layer config — keyless `public.maps` defaults (style/center/zoom) + private `maps.geocodingUrl` (Nominatim base) |
| `server/api/maps/geocode.get.ts` | Server-side geocoding proxy → Nominatim; normalises to a `{ features: [...] }` shape |
| `app/components/Map.vue` | Main map container — renders `VMap` from `@geoql/v-maplibre`, emits `@load` with the maplibre `Map` |
| `app/components/Marker.vue` | Map marker (imperative `maplibre-gl` Marker — color, drag, popup text) |
| `app/components/Popup.vue` | Popup component (imperative `maplibre-gl` Popup with slot content) |
| `app/components/Preview.vue` | Location preview thumbnail with modal |
| `app/components/CurrentLocationButton.vue` | "Use my location" button — geolocation + reverse-geocode in one click |
| `app/components/Blocks/*Render.vue` | Editor block renderers (map block, collection map block) |
| `app/composables/useMapConfig.ts` | Reads `public.maps` config; `isConfigured` is always `true` (keyless) |
| `app/composables/useGeocode.ts` | Geocoding (address ↔ coords) via the server proxy |
| `app/composables/useCurrentLocation.ts` | Browser geolocation + reverse-geocode in one call |
| `app/composables/useMarkerColor.ts` | Derives marker color from CSS `--ui-primary` |
| `app/composables/useMapStyles.ts` | OpenFreeMap style presets (`MAP_STYLES`, `getMapStyle`) + legacy `MAPBOX_STYLES`/`getMapboxStyle` aliases |

## Configuration

### Quick Start

1. Add `@fyit/crouton-maps` to your `extends` array
2. That's it — maps work with **no environment variables**.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-maps'
  ]
  // No runtimeConfig and no tokens needed.
})
```

### Environment Variables (all optional)

```bash
# .env

# Override the default OpenFreeMap base style (preset name or full style URL)
MAPS_STYLE=https://tiles.openfreemap.org/styles/positron

# Point geocoding at a self-hosted Nominatim instance to avoid the public
# server's usage policy / rate limits (defaults to the public OSM instance)
NOMINATIM_URL=https://nominatim.example.com
```

On Cloudflare these map to `NUXT_PUBLIC_MAPS_STYLE` and `NUXT_MAPS_GEOCODING_URL`.

### No Graceful-Degradation Needed

Because tiles and geocoding are keyless, maps always render — there is no
"set your token" placeholder. `useMapConfig().isConfigured` remains in the
return shape (always `true`) for backwards compatibility.

> Note: OpenFreeMap and the public Nominatim instance are community services.
> For production volume, self-host (set `NOMINATIM_URL`) or use a paid tile host
> by overriding `MAPS_STYLE` with that provider's style URL.

### Optional Overrides

```typescript
runtimeConfig: {
  public: {
    maps: {
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [4.9041, 52.3676],  // Amsterdam [lng, lat]
      zoom: 10
    }
  }
}
```

## Components

### CroutonMapsMap

```vue
<CroutonMapsMap
  :center="[-122.4194, 37.7749]"
  :zoom="12"
  height="500px"
  @load="handleMapLoad"
>
  <template #default="{ map }">
    <CroutonMapsMarker :map="map" :position="position" color="red" />
  </template>
</CroutonMapsMap>
```

`@load` emits the underlying **maplibre-gl `Map`** instance. The `style` prop
accepts a preset name (`'dark'`, `'positron'`, …) or a full style URL. Without
an explicit `style`, the map auto-switches between light/dark with color mode.

### CroutonMapsMarker

```vue
<!-- Safe: popupText renders as plain text (no XSS risk) -->
<CroutonMapsMarker
  :map="map"
  :position="[-122.4194, 37.7749]"
  :popup-text="locationName"
  color="red"
  @click="handleClick"
  @dragEnd="handleDragEnd"
/>
```

Markers are imperative `maplibre-gl` markers (the library's `VMarker` emits no
events), so drag (`@dragStart`/`@drag`/`@dragEnd`), `@click`, and animated
position transitions are all supported.

### CroutonMapsPopup / CroutonMapsPreview / CroutonMapsCurrentLocationButton

Unchanged public API — see the component files. `CurrentLocationButton` emits a
`GeocodeResult` from one click (geolocation → reverse-geocode).

## Composables

```typescript
// Geocoding (proxied to Nominatim server-side)
const { geocode, reverseGeocode, loading, error } = useGeocode()
const coords = await geocode('1600 Amphitheatre Parkway')
const address = await reverseGeocode([-122.0840575, 37.4220656])

// Browser geolocation → reverse-geocode in one call
const { getCurrentLocation } = useCurrentLocation()

// Style presets
import { MAP_STYLES, getMapStyle } from '#imports'
```

## Style Presets (OpenFreeMap)

```typescript
import { MAP_STYLES } from '#imports'

MAP_STYLES.liberty   // Full-detail default (recommended)
MAP_STYLES.positron  // Ultra-clean light
MAP_STYLES.bright    // High-contrast
MAP_STYLES.dark      // Dark
MAP_STYLES.fiord     // Muted

// Legacy preset names still resolve (mapped to closest OpenFreeMap style):
// streets/standard/outdoors → liberty, light → positron, satellite → liberty
```

`MAPBOX_STYLES` / `getMapboxStyle` are kept as deprecated aliases of
`MAP_STYLES` / `getMapStyle`.

## Component Naming

Components auto-import with `CroutonMaps` prefix (defined in `nuxt.config.ts`):
- `Map.vue` → `<CroutonMapsMap />`
- `Marker.vue` → `<CroutonMapsMarker />`
- `Popup.vue` → `<CroutonMapsPopup />`
- `Preview.vue` → `<CroutonMapsPreview />`
- `CurrentLocationButton.vue` → `<CroutonMapsCurrentLocationButton />`

## Common Tasks

### Use a custom / paid tile provider
Set `MAPS_STYLE` (or `public.maps.style`) to that provider's MapLibre style URL,
or pass a `style` URL per `<CroutonMapsMap>`.

### Add geocoding autocomplete
Combine `useGeocode()` with `UInput` and debounced search.

### Self-host geocoding
Run Nominatim and set `NOMINATIM_URL` — the server proxy uses it transparently.

## Dependencies

- **Extends**: `@fyit/crouton-core`
- **Core**: `@geoql/v-maplibre ^3.0.1`, `maplibre-gl ^6.14.0` (v6 is ESM-only:
  import named exports, there is no `default` export)
- **Peer deps**: `nuxt ^4.0.0`, `@nuxt/ui ^4.3.0`
- **Worker pin (#2291):** `@geoql/v-maplibre` bundles its own maplibre worker
  (3.0.1 → maplibre 6.10.0). `Map.vue` sets maplibre's own worker
  (`maplibre-gl/dist/maplibre-gl-worker.mjs?url`) first, so the worker always
  matches the installed `maplibre-gl`. A mismatched worker fails every tile with
  "reading 'width'" and the map shows "Failed to load map".
- `@geoql/v-maplibre`'s deck.gl / GeoTIFF / LiDAR / wind peers are **optional** —
  not installed unless you import those subpaths (we only use `VMap`).

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `MAPS_STYLE` | No | Default OpenFreeMap style URL (or preset). Defaults to `liberty`. |
| `NOMINATIM_URL` | No | Nominatim base URL for geocoding. Defaults to the public OSM instance. |

No tokens are required for the maps to render or geocode.

## Migration note (Mapbox → MapLibre)

`MAPBOX_TOKEN` / `MAPBOX_PUBLIC_TOKEN` and the `nuxt-mapbox` module are gone.
The public component/composable API is unchanged (`CroutonMapsMap`,
`CroutonMapsMarker`, `useGeocode`, `getMapboxStyle` alias), so consumers like
`crouton-bookings` need no changes. The main behavioural change: `mapbox://…`
style URLs are no longer valid — use OpenFreeMap presets/URLs.

## Testing

```bash
pnpm -r --filter './apps/*' typecheck  # MANDATORY after changes
```
