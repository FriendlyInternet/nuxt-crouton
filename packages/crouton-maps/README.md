# @fyit/crouton-maps

> Map integration layer for Nuxt Crouton with MapLibre GL — no API key required

Add interactive maps to your Nuxt Crouton applications. Built on **MapLibre GL**
via [`@geoql/v-maplibre`](https://v-maplibre.geoql.in), with **OpenFreeMap**
vector tiles and **Nominatim** (OpenStreetMap) geocoding — both keyless.

## Features

- 🗺️ **MapLibre GL** — beautiful, performant open-source vector maps
- 🆓 **No tokens** — OpenFreeMap tiles + Nominatim geocoding work out of the box
- 🎯 **Geocoding** — address ↔ coordinates via a server-side proxy
- 📍 **Markers & popups** — simple components with drag, click, and animation
- 🎨 **Nuxt UI 4 styling** — seamless integration with the Crouton design system
- 📦 **TypeScript first** — full type safety
- 🏠 **Self-hostable** — point at your own tile host / Nominatim instance

## Installation

```bash
pnpm add @fyit/crouton-maps
```

## Setup

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

That's it — maps render immediately. All environment variables are **optional**:

```bash
# .env (optional)
MAPS_STYLE=https://tiles.openfreemap.org/styles/positron  # override default style
NOMINATIM_URL=https://nominatim.example.com               # self-hosted geocoder
```

## Usage

### Basic Map

```vue
<template>
  <CroutonMapsMap :center="[4.9041, 52.3676]" :zoom="12" height="500px" />
</template>
```

### Map with Markers

```vue
<template>
  <CroutonMapsMap :center="[4.9041, 52.3676]" :zoom="12" height="500px">
    <template #default="{ map }">
      <CroutonMapsMarker
        :map="map"
        :position="[4.9041, 52.3676]"
        :popup-text="'Amsterdam'"
        color="red"
      />
    </template>
  </CroutonMapsMap>
</template>
```

### Geocoding

```vue
<script setup lang="ts">
const { geocode, reverseGeocode, loading, error } = useGeocode()

const result = await geocode('1600 Amphitheatre Parkway, Mountain View, CA')
// { coordinates: [lng, lat], address, placeName, context: { postcode, place, region, country } }

const address = await reverseGeocode([-122.0840575, 37.4220656])
</script>
```

## Components

| Component | Description |
|-----------|-------------|
| `<CroutonMapsMap>` | Map container (renders MapLibre via `VMap`). `@load` emits the maplibre `Map`. Slot `{ map }` for markers/popups. |
| `<CroutonMapsMarker>` | Marker with `color`, `popupText`, drag (`@dragEnd`), `@click`, animated position. |
| `<CroutonMapsPopup>` | Standalone popup with slotted content. |
| `<CroutonMapsPreview>` | Compact location thumbnail + modal — for forms/cards. |
| `<CroutonMapsCurrentLocationButton>` | One-click geolocation → reverse-geocode, emits a `GeocodeResult`. |

`CroutonMapsMap` `style` prop accepts a preset name (`'dark'`, `'positron'`, …)
or a full MapLibre style URL. Without an explicit `style`, the map auto-switches
between light/dark with the app's color mode.

## Style Presets (OpenFreeMap)

```typescript
import { MAP_STYLES, getMapStyle } from '#imports'

MAP_STYLES.liberty   // full-detail default (recommended)
MAP_STYLES.positron  // ultra-clean light
MAP_STYLES.bright    // high-contrast
MAP_STYLES.dark      // dark
MAP_STYLES.fiord     // muted

getMapStyle('dark')                               // → OpenFreeMap dark URL
getMapStyle('https://example.com/style.json')     // returned as-is
```

Legacy preset names still resolve (`streets`/`standard`/`outdoors` → liberty,
`light` → positron, `satellite` → liberty). `MAPBOX_STYLES` / `getMapboxStyle`
remain as deprecated aliases.

## Composables

```typescript
const { geocode, reverseGeocode, loading, error } = useGeocode()
const { getCurrentLocation } = useCurrentLocation()  // geolocation + reverse-geocode
const markerColor = useMarkerColor()                 // syncs with --ui-primary
const { style, center, zoom } = useMapConfig()
```

## TypeScript

```typescript
import type {
  MapConfig, MapInstance, GeocodeResult, UseMapOptions, MapStylePreset,
  Map, Marker, Popup, MapOptions, MarkerOptions, PopupOptions, LngLatLike
} from '@fyit/crouton-maps'
```

## Notes & Limits

- **OpenFreeMap** and the **public Nominatim** instance are free community
  services. For production volume, self-host (set `NOMINATIM_URL`) or use a paid
  tile host (override `MAPS_STYLE` with that provider's MapLibre style URL).
- Nominatim's usage policy requires an identifying `User-Agent` — the server
  proxy sets one automatically.
- `mapbox://…` style URLs are **not** supported (this is MapLibre, not Mapbox).

## Migration (Mapbox → MapLibre)

Previously this package used `nuxt-mapbox` + `mapbox-gl` and required
`MAPBOX_TOKEN` / `MAPBOX_PUBLIC_TOKEN`. Those are gone. The public component and
composable API is unchanged, so consumers need no code changes — only drop the
Mapbox env vars and stop passing `mapbox://` style URLs.

## License

MIT — Issues and PRs welcome at https://github.com/FriendlyInternet/nuxt-crouton

---

Built with ❤️ by FYIT
