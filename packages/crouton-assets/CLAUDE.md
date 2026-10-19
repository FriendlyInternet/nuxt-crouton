# CLAUDE.md - @fyit/crouton-assets

## Package Purpose

Centralized asset management for Nuxt Crouton. Provides picker/uploader components and composables for a full-featured media library with team-based ownership, metadata tracking, and multi-file-type support.

## Key Files

| File | Purpose |
|------|---------|
| `app/components/Picker.vue` | Compact trigger button → UModal browser for selecting assets in forms |
| `app/components/Library.vue` | Full media browser using CroutonCollection (search, grid, CRUD for free) |
| `app/components/Card.vue` | Media card for CroutonCollection grid (image/icon, edit/delete) |
| `app/components/AssetTile.vue` | Selection tile for Picker modal (selected state, checkmark) |
| `app/components/Uploader.vue` | Upload with optional crop step and metadata form |
| `app/composables/useAssetUpload.ts` | Programmatic upload/delete helper with progress tracking |
| `collections/assets/` | **The `croutonAssets` collection, owned end to end (#2278)** — `server/database/{schema,queries}.ts` (`crouton_assets`), CRUD routes `server/api/teams/[id]/crouton-assets/*`, `types.ts`, `app/composables/useCroutonAssets.ts`, `app/components/List.vue` (`CroutonAssetsList`). Extended by `nuxt.config.ts`; registered in `app/app.config.ts` (`container: 'modal'`, form = `CroutonAssetsForm`). Moved verbatim from velo's generated `crouton` layer; table, route path and registry key unchanged. Importable: `@fyit/crouton-assets/collections/assets/types` and `…/server/database/{schema,queries}` |
| `server/db/schema.ts` | Re-exports `croutonAssets` so each consuming app's `db:generate` picks up the table |
| `assets-schema.json` | Field description read by the manifest for AI hints. **Not** a generator input any more (#2278); the source of truth is `collections/assets/server/database/schema.ts`. Note it marks `alt` translatable, the table has no `translations` column (velo's shape) |

## Architecture

```
nuxt-crouton (base)
├── POST /api/upload-image      # Upload to blob
├── GET /images/[pathname]      # Serve from blob
├── CroutonImageUpload          # Simple file picker

nuxt-crouton-assets (this package)
├── CroutonAssetsPicker         # Browse/select UI
├── CroutonAssetsUploader       # Upload + metadata
├── useAssetUpload()            # Composable
├── assets-schema.json          # Schema template

Your Project
└── extends @fyit/crouton-assets — generates nothing for assets (#2278)
```

## Setup

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-assets'
  ],
  hub: {
    blob: true  // Required: Enable NuxtHub blob storage
  }
})
```

## The Assets Collection Ships With the Package (#2278)

Extending the package gives the app the `croutonAssets` collection (table `crouton_assets`,
routes `/api/teams/[id]/crouton-assets`). Run `pnpm db:generate` to add the table to the app's
migrations. The manifest sets `ownsCollections: true` with layer `crouton` / collection `asset`,
so `crouton config` refuses `crouton/assets`. Changing a column = edit
`collections/assets/server/database/schema.ts` here, then `db:generate` in each app.

**Known gap (#2311):** an app field with `"refTarget": "assets"` is refused by the CLI, because
the generator only references collections the app generates. Use an `image`/`file` field (renders
`CroutonAssetsPicker`, stores the asset id) until #2311 lands.

## Usage

### In Schema (Asset Picker)

```json
{
  "imageId": {
    "type": "string",
    "refTarget": "assets",
    "meta": {
      "component": "CroutonAssetsPicker",
      "label": "Featured Image"
    }
  }
}
```

### Direct Upload (Simple)

```vue
<CroutonImageUpload
  v-model="imageUrl"
  @file-selected="handleUpload"
/>
```

### Asset Picker (Full Library)

```vue
<CroutonAssetsPicker v-model="selectedAssetId" />
```

## Component Naming

Components auto-import with `CroutonAssets` prefix:
- `Picker.vue` → `<CroutonAssetsPicker />`
- `Uploader.vue` → `<CroutonAssetsUploader />`
- `Library.vue` → `<CroutonAssetsLibrary />`
- `Card.vue` → `<CroutonAssetsCard />` (used by CroutonCollection grid via `:card-component`)
- `AssetTile.vue` → `<CroutonAssetsAssetTile />` (used by Picker modal)

## Asset Schema

```typescript
{
  id: string              // Primary key
  teamId: string          // Team ownership
  userId: string          // Uploader
  filename: string        // Original filename
  pathname: string        // Blob storage path
  contentType: string     // MIME type
  size: number            // Bytes
  category: string        // 'image' | 'video' | 'audio' | 'document' | 'other'
  width: number           // Image width in px (0 for non-images)
  height: number          // Image height in px (0 for non-images)
  alt: string             // Alt text (translatable)
  uploadedAt: Date
}
```

## Common Tasks

### Add custom metadata field
1. Add the column in `collections/assets/server/database/schema.ts` (+ `types.ts`, the composable, `assets-schema.json`)
2. `pnpm db:generate` in every app that extends this package
3. Update uploader component if needed

### Filter assets by type
Query with `contentType` filter (e.g., `image/*`).

## Dependencies

- **Extends**: `@fyit/crouton-core` (required)
- **Requires**: `@nuxthub/core` with `hub.blob: true`
- **Peer deps**: `@vueuse/core ^11.0.0`

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
