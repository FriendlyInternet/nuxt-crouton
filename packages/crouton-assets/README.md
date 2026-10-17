# @fyit/crouton-assets

Centralized asset management system for Nuxt Crouton. Provides a full-featured media library with team-based ownership, metadata tracking, and browsing capabilities.

## Features

- 📸 **Centralized Asset Library** - Single source of truth for all uploads
- 🎯 **Asset Picker UI** - Browse and select existing assets with thumbnails
- 📊 **Rich Metadata** - Track filename, size, MIME type, alt text, upload date
- 👥 **Team-Based** - Assets are scoped to teams/organizations
- 🔍 **Search & Filter** - Find assets quickly
- ♿ **Accessibility** - Alt text support for all images
- 🌍 **i18n Ready** - Translatable alt text (with nuxt-crouton-i18n)

## Installation

```bash
pnpm add @fyit/crouton-assets
```

## Setup

### 1. Install the package

```bash
pnpm add @fyit/crouton-assets
```

### 2. Configure Nuxt

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-assets'  // Add assets layer
  ],
  hub: {
    blob: true  // Required: Enable NuxtHub blob storage
  }
})
```

### 3. Generate the assets collection

Use the collection generator to create the assets collection in your project:

```bash
crouton-generate core assets --fields-file=node_modules/@fyit/crouton-assets/assets-schema.json --dialect=sqlite
```

Or create your own schema and generate:

```json
// assets-schema.json
{
  "id": { "type": "string", "meta": { "primaryKey": true } },
  "teamId": { "type": "string", "refTarget": "organisations", "meta": { "required": true } },
  "userId": { "type": "string", "refTarget": "users", "meta": { "required": true } },
  "filename": { "type": "string", "meta": { "required": true } },
  "pathname": { "type": "string", "meta": { "required": true } },
  "contentType": { "type": "string" },
  "size": { "type": "number" },
  "alt": { "type": "string" },
  "uploadedAt": { "type": "date" },
  "updatedBy": { "type": "string", "refTarget": "users" }
}
```

```bash
crouton-generate core assets --fields-file=assets-schema.json --dialect=sqlite
```

This creates `layers/core/collections/assets/` in your project with all the CRUD endpoints and components.

## Usage

### In Forms (Schema Definition)

Use the asset picker to reference assets by ID:

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

### Direct Upload Component

For simple uploads without the asset library:

```vue
<template>
  <CroutonImageUpload
    v-model="imageUrl"
    @file-selected="handleUpload"
  />
</template>

<script setup>
const imageUrl = ref('')

const handleUpload = async (file) => {
  if (!file) return

  const formData = new FormData()
  formData.append('image', file)

  const pathname = await $fetch('/api/upload-image', {
    method: 'POST',
    body: formData
  })

  imageUrl.value = `/images/${pathname}`
}
</script>
```

### Asset Picker Component

Browse and select from existing assets:

```vue
<template>
  <CroutonAssetsPicker v-model="selectedAssetId" />
</template>

<script setup>
const selectedAssetId = ref('')
</script>
```

## Architecture

### Base Package (nuxt-crouton)
Provides core upload infrastructure:
- `POST /api/upload-image` - Upload to blob storage
- `GET /images/[pathname]` - Serve from blob storage
- `CroutonImageUpload` - Simple file picker component
- `CroutonAvatarUpload` - Avatar variant component

### Assets Package (this package) - Provides Tools
The package provides reusable components and composables:
- `CroutonAssetsPicker` - Browse/select assets UI component
- `CroutonAssetsUploader` - Upload + metadata form component
- `useAssetUpload()` - Composable for programmatic uploads
- `assets-schema.json` - Reference schema for generation

### Your Project - Generated Collection
You generate the actual assets collection using crouton-generate:
- `layers/core/collections/assets/` - Generated collection
  - Form.vue, List.vue - CRUD UI
  - API endpoints - GET/POST/PATCH/DELETE at `/api/teams/[id]/assets`
  - Database schema - Assets table with all metadata
  - Composable - useCoreAssets() with validation

The package tools (CroutonAssetsPicker, CroutonAssetsUploader) work WITH your generated collection.

## Simple vs. Full Approach

**Simple (Base Package Only)**
```typescript
// Store URL directly in your table
{
  "imageUrl": { "type": "string" }
}
```

**Full Asset Management (With This Package)**
```typescript
// Store asset ID, get all metadata
{
  "imageId": {
    "type": "string",
    "refTarget": "assets",
    "meta": { "component": "CroutonAssetsPicker" }
  }
}
```

## Database Schema

The assets collection includes:

- `id` - Unique identifier
- `teamId` - Team/organization ownership
- `userId` - User who uploaded
- `filename` - Original filename
- `pathname` - Blob storage path
- `contentType` - MIME type
- `size` - File size in bytes
- `alt` - Alt text (translatable)
- `uploadedAt` - Upload timestamp
- `createdAt` / `updatedAt` - Metadata timestamps
- `updatedBy` - Last modifier

## Requirements

- Nuxt 4+
- @fyit/crouton-core
- @nuxthub/core with blob storage enabled
- @vueuse/core

## License

MIT © FYIT
