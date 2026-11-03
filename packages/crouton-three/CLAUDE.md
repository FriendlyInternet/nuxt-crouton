# CLAUDE.md - @fyit/crouton-three

## Package Purpose

TresJS (Three.js for Vue) integration layer for Nuxt Crouton. Wraps `@tresjs/nuxt`
+ `@tresjs/cientos` and provides:
- A flexible **scene wrapper** (`CroutonThreeScene`) for building arbitrary 3D / games
- A **glTF/.glb model viewer** (`CroutonThreeModelViewer`)
- A **game starter** (`CroutonThreeStarterScene`) with WASD/arrow movement
- A **keyboard-controls composable** (`useThreeControls`)
- A **3D Model pages block** for crouton-pages (with i18n + crouton-assets picker integration)

This is an **addon layer** — apps extend it explicitly alongside crouton-core.

## Key Files

| File | Purpose |
|------|---------|
| `nuxt.config.ts` | Layer config — registers `@tresjs/nuxt`, `CroutonThree` component prefix, composables, i18n locales |
| `crouton.manifest.ts` | Package manifest (components, composables, editor blocks) for the registry/AI |
| `app/app.config.ts` | Registers `croutonApps.three` + the `modelBlock` definition (`croutonBlocks`) |
| `app/components/Scene.vue` | `CroutonThreeScene` — canvas + camera + lights + optional orbit controls; default slot rendered inside the canvas |
| `app/components/ModelViewer.vue` | `CroutonThreeModelViewer` — loads a glTF/.glb model with orbit controls + auto-rotate |
| `app/components/StarterScene.vue` | `CroutonThreeStarterScene` — runnable WASD/arrow-controllable cube on a ground plane |
| `app/components/Blocks/ModelBlockRender.vue` | `CroutonThreeBlocksModelBlockRender` — public renderer for the model block. Defers the heavy viewer until it scrolls into view (`useElementVisibility` latch + `LazyCroutonThreeModelViewer` + skeleton), so a below-the-fold model loads three.js / spins up WebGL only when visible. |
| `app/components/Blocks/ModelBlockView.vue` | `CroutonThreeBlocksModelBlockView` — editor NodeView (static preview) |
| `app/components/Blocks/ModelSourcePicker.vue` | `CroutonThreeBlocksModelSourcePicker` — `three-model` field: assets picker if present, URL fallback |
| `app/composables/useThreeControls.ts` | WASD/arrow-key movement → reactive `position` for `<TresMesh>` |
| `i18n/locales/{en,nl,fr}.json` | Block + viewer translations under the `three.*` namespace |

## Setup (consuming app)

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-three'
  ]
})
```

No environment variables or runtime config needed. The `@tresjs/nuxt` module
handles transpilation, the custom renderer, and SSR. All components are
client-only (wrapped in `<ClientOnly>`), so they are safe on SSR pages.

## Building 3D / games

`CroutonThreeScene` gives you a lit canvas with a camera and orbit controls.
The default slot renders **inside** the canvas — drop in any Tres catalogue
content (`<TresMesh>`, `<TresBoxGeometry>`, etc.) or cientos components.

```vue
<CroutonThreeScene :height="600" background="dark" :grid="true">
  <TresMesh :position="[0, 1, 0]" cast-shadow>
    <TresBoxGeometry :args="[1, 1, 1]" />
    <TresMeshStandardMaterial color="orange" />
  </TresMesh>
</CroutonThreeScene>
```

**Movement / input** — `useThreeControls` integrates WASD + arrow keys into a
reactive position each animation frame:

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

`CroutonThreeStarterScene` is the above wired up end-to-end — copy it as a
starting point for a game. For physics, add `@tresjs/rapier` (optional, not
bundled). For an animation loop beyond input, use `@tresjs/core`'s `useLoop()`
inside a child component, or VueUse's `useRafFn`.

> **Async content (models) in a slot** must be wrapped in `<Suspense>`:
> `<CroutonThreeScene><Suspense><GLTFModel path="/m.glb" /></Suspense></CroutonThreeScene>`

## Model Viewer

```vue
<CroutonThreeModelViewer
  src="/models/duck.glb"
  :height="500"
  background="#0b0b12"
  :auto-rotate="true"
/>
```

Renders a placeholder when `src` is empty. The async load is wrapped in
`<Suspense>` with a skeleton fallback.

## 3D Model Pages Block

Registered as `modelBlock` via `croutonBlocks` in `app.config.ts`. It appears
in the crouton-pages block insert menu as **3D Model** (translated) and renders
via `CroutonThreeModelViewer` on the public page.

- **Editor view** (`ModelBlockView.vue`): a static preview card (no live canvas,
  to keep the editor light) with edit/delete controls.
- **Renderer** (`ModelBlockRender.vue`): live `CroutonThreeModelViewer`, client-only.
- **Source field** (`type: 'three-model'`): custom `ModelSourcePicker` — uses
  `CroutonAssetsPicker` when crouton-assets is installed (detected via
  `useCroutonApps().hasApp('assets')`, no hard dependency), with a URL fallback.
  Selecting an asset stores its public blob URL (`/images/[pathname]`).

### Block attributes

| Attr | Type | Default | Notes |
|------|------|---------|-------|
| `src` | string | `''` | Model URL (.glb/.gltf) |
| `title` | string | — | Optional caption below the model |
| `background` | `transparent\|dark\|light` | `transparent` | Mapped to a clear-color in the renderer |
| `autoRotate` | boolean | `true` | |
| `height` | number | `400` | px |

## i18n

Block strings use the `three.*` key namespace (addon convention — explicit keys
on the definition, resolved by crouton-pages' `useBlockI18n`). Translations live
in `i18n/locales/{en,nl,fr}.json` and are merged by `@nuxtjs/i18n` when
crouton-i18n is present. Keep en/nl/fr at parity.

To add a block string: add the key to all three locale files, then reference it
in `app.config.ts` (e.g. `label: 'three.blocks.model.fields.x.label'`).

## Component Naming

Components auto-import with the `CroutonThree` prefix:
- `Scene.vue` → `<CroutonThreeScene />`
- `ModelViewer.vue` → `<CroutonThreeModelViewer />`
- `StarterScene.vue` → `<CroutonThreeStarterScene />`
- `Blocks/ModelBlockRender.vue` → `<CroutonThreeBlocksModelBlockRender />`
- `Blocks/ModelBlockView.vue` → `<CroutonThreeBlocksModelBlockView />`
- `Blocks/ModelSourcePicker.vue` → `<CroutonThreeBlocksModelSourcePicker />`

## Dependencies

- **Extends**: `@fyit/crouton-core`
- **npm**: `@tresjs/nuxt`, `@tresjs/core`, `@tresjs/cientos`, `three`
- **Peer**: `@nuxt/ui`, `@vueuse/core` (for `useThreeControls`), `nuxt`
- **Optional, detected at runtime**: `@fyit/crouton-assets` (model picker), `@fyit/crouton-pages` (block host)

## Testing

```bash
pnpm typecheck   # per-app typecheck (MANDATORY after changes)
```
