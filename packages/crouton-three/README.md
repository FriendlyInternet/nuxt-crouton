# @fyit/crouton-three

TresJS (Three.js for Vue) integration for [Nuxt Crouton](https://github.com/FriendlyInternet/nuxt-crouton).

Spin up 3D inside a crouton app — build interactive scenes and games, drop a
glTF/.glb model viewer anywhere, and add a **3D Model** block to your CMS pages.
Integrates with crouton-pages (block), crouton-assets (model picker), and
crouton-i18n (translated block UI) — with no hard dependency on any of them.

## Install

This package ships as a Nuxt layer. Add it to your app's `extends`:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-three'
  ]
})
```

No env vars or runtime config required. `@tresjs/nuxt` handles the renderer,
transpilation and SSR; every component is client-only and SSR-safe.

## Quick start

### A scene / game

```vue
<template>
  <CroutonThreeScene :height="600" background="dark" :grid="true">
    <TresMesh :position="[0, 1, 0]" cast-shadow>
      <TresBoxGeometry :args="[1, 1, 1]" />
      <TresMeshStandardMaterial color="orange" />
    </TresMesh>
  </CroutonThreeScene>
</template>
```

### A controllable object (WASD / arrow keys)

```vue
<script setup lang="ts">
const { position } = useThreeControls({ speed: 0.1, bounds: 9 })
</script>

<template>
  <CroutonThreeScene :controls="false">
    <TresMesh :position="position">
      <TresBoxGeometry :args="[1, 1, 1]" />
      <TresMeshStandardMaterial color="#22d3ee" />
    </TresMesh>
  </CroutonThreeScene>
</template>
```

Or just drop the ready-made starter and start moving immediately:

```vue
<CroutonThreeStarterScene :height="600" />
```

### A model

```vue
<CroutonThreeModelViewer src="/models/duck.glb" :height="500" :auto-rotate="true" />
```

## Components

| Component | Purpose |
|-----------|---------|
| `CroutonThreeScene` | Canvas + camera + lights + optional orbit controls; default slot rendered inside the canvas |
| `CroutonThreeModelViewer` | glTF/.glb model viewer with orbit controls and auto-rotate |
| `CroutonThreeStarterScene` | Runnable game starter — WASD/arrow-controllable cube on a ground plane |

## Composable

```ts
const { position, state, keys } = useThreeControls({ speed: 0.08, start: [0, 0.5, 0], bounds: 9 })
// bind `position` to <TresMesh :position="position">
```

## Pages block

When used with `@fyit/crouton-pages`, a **3D Model** block becomes available in
the page editor. It loads a `.glb/.gltf` model (picked from your media library
when `@fyit/crouton-assets` is installed, otherwise via URL) and renders it with
orbit controls on the public page. Block UI is translated (en/nl/fr) when
`@fyit/crouton-i18n` is present.

## License

MIT
