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
| `assets-schema.json` | Reference schema (includes category, width, height fields) |

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

Your Project (generated)
├── layers/crouton/collections/assets/
│   ├── API endpoints (crouton-assets)
│   ├── Form.vue, List.vue
│   └── useCroutonAssets()
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

## Generate Assets Collection

```bash
crouton-generate crouton assets \
  --fields-file=node_modules/@fyit/crouton-assets/assets-schema.json \
  --dialect=sqlite
```

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
1. Extend `assets-schema.json` with new field
2. Regenerate collection
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
