# CLAUDE.md - @fyit/crouton

## Package Purpose

Core CRUD layer for Nuxt applications. Provides composables, components, and server utilities for building data-driven admin panels with team-scoped access, nested forms, and smart caching.

**Single-install experience:** Installing `@fyit/crouton` automatically includes i18n, auth, and admin packages - no need to install them separately.

## Auto-Included Packages

When you extend `nuxt-crouton`, you automatically get:

| Package | Provides | Routes |
|---------|----------|--------|
| `@nuxthub/core` | Database (D1/SQLite), KV storage, blob storage, multi-vendor support | None |
| `nuxt-crouton-i18n` | Translation system (`useT`), DB-backed translations, team overrides | None |
| `nuxt-crouton-auth` | Authentication, teams, sessions, OAuth, passkeys, 2FA | `/auth/*` |
| `nuxt-crouton-admin` | Super admin dashboard, user/team management, impersonation | `/super-admin/*` |

**Order matters:** NuxtHub loads first (provides database), then i18n (provides translations), then auth (uses both), then admin (uses all).

### Simplified Setup

```typescript
// nuxt.config.ts - BEFORE (manual)
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',
    '@fyit/crouton-auth',
    '@fyit/crouton-admin',
    '@fyit/crouton-i18n',
    '@fyit/crouton-bookings',
  ]
})

// nuxt.config.ts - AFTER (auto-included)
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',           // Includes auth, admin, i18n
    '@fyit/crouton-bookings',       // Optional apps
  ]
})

## Key Files

| File | Purpose |
|------|---------|
| `shared/seed/` | Composable seeding contract + runner core (`SeedProvider`, `SeedContext`, `buildUpsert`, `seedId`, `collectSeedSql`) — exported at `@fyit/crouton-core/shared/seed` |
| `server/utils/encryption.ts` | AES-256-GCM encryption for storing third-party secrets at rest |
| `server/utils/tiptap-renderer.ts` | Server-side TipTap JSON to HTML conversion (auto-imported by Nitro) |
| `app/composables/useCrouton.ts` | Modal/slideover state management (nested up to 5 levels) |
| `app/composables/useCollectionQuery.ts` | Async data fetching with query-based caching |
| `app/composables/useCollectionMutation.ts` | Create/update/delete with auto cache invalidation |
| `app/composables/useCollections.ts` | Collection config registry from `app.config.croutonCollections` |
| `app/composables/useCroutonShortcuts.ts` | Keyboard shortcuts for CRUD operations |
| `app/composables/useCollectionExport.ts` | CSV/JSON export for collection data |
| `app/composables/useCollectionImport.ts` | CSV/JSON import with column mapping, validation, and batched POST |
| `app/composables/useDisplayConfig.ts` | Resolves display config (title/subtitle/image/badge/description) with auto-inference |
| `app/components/Collection.vue` | Multi-layout display (table, list, grid, tree, kanban) |
| `app/components/CollectionSkeleton.vue` | `CroutonCollectionSkeleton` — layout-aware shimmer (table/list/grid) used as the `<Suspense>` fallback in `CollectionViewer` so the viewer reveals the populated result at once instead of flashing a loader + filling in row-by-row |
| `app/components/Form.vue` | Main CRUD form handler with nested modal support |
| `app/components/Detail.vue` | `CroutonDetail` — Generic detail view using display config and runtime field metadata |
| `app/components/DefaultCard.vue` | `CroutonDefaultCard` — Display-aware card (title/image/badge from display config) |
| `app/components/ItemCardMini.vue` | `CroutonItemCardMini` — Display-aware mini card for references and lists |
| `app/components/ShortcutHint.vue` | Visual keyboard shortcut badges (`<kbd>` elements) |
| `app/components/ExportButton.vue` | Ready-to-use export dropdown button |
| `app/components/ImportButton.vue` | Ready-to-use import button with file picker |
| `app/components/ImportPreviewModal.vue` | Multi-step import preview with mapping, validation, and progress |
| `app/components/WorkspaceLayout.vue` | `CroutonWorkspaceLayout` — Reusable split-panel workspace shell (resizable sidebar + content, state machine, URL sync, mobile slideover, keyboard shortcuts). Used by crouton-pages and crouton-flow. |
| `app/composables/useTeamContext.ts` | Team context access (teamId, teamSlug from route or auth) |
| `app/composables/useImageCrop.ts` | Cropperjs v2 composable for image cropping |
| `app/components/ImageCropper.vue` | Reusable image crop modal with rotate/zoom/aspect ratio |
| `app/components/ImageUpload.vue` | File picker with optional crop support |
| `app/components/UsersAvatarUpload.vue` | Avatar upload with 1:1 circular crop |
| `app/components/DropZone.vue` | Drag-and-drop file upload zone (VueUse) |
| `app/components/QrCode.vue` | `CroutonQrCode` — renders any string (usually a URL) as an inline SVG QR code via `uqr` (zero-dep, SSR-safe). Props: `data`, `size?` (px). |
| `app/components/DeleteButton.vue` | `CroutonDeleteButton` — two-step pill delete (click arms "sure?", click again emits `confirm`; mouseleave disarms). Props: `loading?`, `expanded?` (always show the label; collapsed mode is an icon pill that expands on hover — pointer-only, so forms/touch surfaces pass `expanded`). Parent performs the delete. `rounded-md`, `min-h-7`: stretches to match neighbors in a `flex items-stretch` row (sales form footers pair it with `CroutonFormActionButton class="flex-1"`). |
| `server/api/upload-image.post.ts` | Authenticated file upload to blob storage |
| `server/api/upload-image.delete.ts` | Authenticated file deletion from blob storage |
| `server/routes/images/[pathname].get.ts` | Image serving with cache headers |
| `app/components/stubs/` | No-op stubs (`priority: -1`) for optional package components |
| `app/composables/useCroutonApps.ts` | App registry — `hasApp('assets')` for optional package detection |
| `app/types/layout-block.ts` | `CroutonLayoutBlockDefinition` (id/name/description/icon + component **string** + `kind`/`configSchema`) — the placeable-block contract (mirrors `CroutonPageType`). Plus the **sizing contract** (#710): `minWidth`/`minHeight`/`maxWidth`/`defaultSize`/`aspect`/`resize`/`density` — all optional; undeclared = fully fluid (`minWidth` 0). |
| `app/types/layout.ts` | `LayoutTree` / `LayoutNode` (`split` \| `leaf`) — the persisted "layout is data" tree. Plus the **collapse contract** (#852): `collapsible` / `collapse` (`LayoutCollapseStyle` — a closed enum, `gutter-tabs` first/reference) / `open` on every node (keyed by its path), so a pane can persist its open/closed state + chosen affordance alongside its size. |
| `app/types/block-core.ts` | `CroutonBlockCore` (#716) — the surface-agnostic projection both block registries share (id/name/description/icon/category + `renderer` NAME + `clientOnly` + `surface`). A read-side projection, **not** a base both definitions `extends` (keeps the working TipTap `croutonBlocks` shape — `type`/`components.renderer` — untouched). |
| `app/composables/useCroutonBlockCatalog.ts` | **Unified block catalog** (#716) — one read facade over BOTH registries (`croutonBlocks` TipTap content + `croutonLayoutBlocks` panes). `getBlock(id)` / `listBlocks(surface?)` answer from a single merged `id → CroutonBlockCore` map (pane wins an id collision). Pure `documentBlockToCore` / `layoutBlockToCore` / `buildBlockCatalog` exported for tests. So pages/panes/(later)flow ask one place. |

> **The layout *engine* now lives in `@fyit/crouton-layout`** (extraction epic #751): the editor/renderer components (`CroutonLayout*`), the compose/viability/edit utils + the `sanitizeLayoutTree` gate, the `useCroutonLayout{Blocks,Edit,Store}` composables, the `croutonLayoutBlocks` defaults, and the `layout_configs` schema + API + `/admin/[team]/layout` page. Core keeps only the **shared types** above (`layout.ts`, `layout-block.ts`, `block-core.ts`) + the `useCroutonBlockCatalog` facade — so feature packages (bookings/pages) depend on core, not on the layout layer. See `packages/crouton-layout/CLAUDE.md`.
| `app/composables/useCroutonRedirects.ts` | Built-in redirects collection config, Zod schema, columns |
| `app/components/RedirectsList.vue` | `CroutonRedirectsList` — Admin list with path display and status badge |
| `app/components/RedirectsForm.vue` | `CroutonRedirectsForm` — Create/edit form for redirects |
| `server/middleware/redirects.ts` | Server middleware — matches incoming paths against active redirects |
| `server/utils/redirectCache.ts` | In-memory redirect cache with thundering herd protection |
| `server/database/schema/redirects.ts` | Drizzle schema for `crouton_redirects` table |
| `server/database/queries/redirects.ts` | CRUD queries + `getActiveCroutonRedirects()` for cache |
| `server/api/teams/[id]/crouton-redirects/` | Team-scoped CRUD API for managing redirects |
| `types/redirects.ts` | `CroutonRedirect`, `CroutonRedirectFormData`, `NewCroutonRedirect` types |

## Architecture

```
useCrouton()            → Modal state (open/close/nesting)
useCollectionQuery()    → Data fetching (SSR-safe, cached)
useCollectionMutation() → CRUD operations (auto-refresh cache)
useCollectionExport()   → CSV/JSON export (client-side generation + download)
useCollectionImport()   → CSV/JSON import (parse, map columns, validate, batch POST)
useCollections()        → Config registry (componentMap, apiPath, references, display, publishable)
useDisplayConfig()      → Resolves display roles (title/subtitle/image/badge) from config + auto-inference
useCroutonShortcuts()   → Keyboard shortcuts (create, save, close, delete, search)
useTeamContext()        → Team ID/slug from route params (client-side)
```

## Seeding Contract (shared/seed/)

The home of composable, per-package demo seeding (epic #82). Pure TS (no Nuxt
runtime), exported at `@fyit/crouton-core/shared/seed`:

- `SeedProvider` (`{ id, dependsOn?, seed(ctx) }`) + `SeedContext` (`teamId`,
  `teamSlug`, `locale`, `upsert(table, byId, values)`, `now`, optional
  `createPageWithBlocks`). Each package ships a provider at `<pkg>/seed`.
- `buildUpsert(table, byId, values)` → idempotent `INSERT … ON CONFLICT(byId)
  DO UPDATE SET …` SQL (identifiers double-quoted so `order` is safe;
  `createdAt` held immutable on update). `seedId(...parts)` / `seedOrgId(slug)`
  derive stable ids so re-runs upsert instead of duplicating.
- `topoSort(providers)` + `collectSeedSql({ providers, teamSlug, teamId, locale,
  withStaff, createPageWithBlocks })` order providers by `dependsOn` and return
  the combined SQL. The CLI `crouton-seed` command wraps this with discovery +
  `wrangler d1 execute` transport (see crouton-cli CLAUDE.md).

Seeding generates SQL executed via `wrangler d1`, so it runs identically against
local SQLite and remote D1 with no live DB connection.

## Encryption Utility (server/utils/encryption.ts)

Reusable AES-256-GCM encryption for storing third-party secrets (API keys, tokens) at rest. Auto-imported by all layers via Nitro.

**Functions:**
- `encryptSecret(plaintext)` → `"base64iv:base64ciphertext"`
- `decryptSecret(encrypted)` → plaintext
- `maskSecret(value, prefixChars?, suffixChars?)` → `"sk-ant-...7xkQ"`
- `isEncryptedSecret(value)` → boolean

**Setup:** Set `NUXT_ENCRYPTION_KEY` env var (generate with `openssl rand -base64 32`).

**Usage pattern:**
```typescript
// On save (e.g., PATCH endpoint)
const encrypted = await encryptSecret(body.apiKey)
const hint = maskSecret(body.apiKey)
// Store both encrypted + hint in DB

// On use (e.g., making API calls)
const plaintext = await decryptSecret(row.apiKey)

// On read (GET endpoints)
// Return hint only, never the encrypted value
```

## Team Authentication

Team auth is provided by `@crouton/auth` (Better Auth with organization mode):

- **Client-side**: Use `useTeamContext()` composable for `teamId` and `teamSlug`
- **Server-side**: Use `@crouton/auth/server` utilities (e.g., `resolveTeamAndCheckMembership`)
- **Generated APIs**: Import from `@crouton/auth/server` (auto-generated by collection generator)

## Component Naming

All components auto-import with `Crouton` prefix:
- `Form.vue` → `<CroutonForm />`
- `Collection.vue` → `<CroutonCollection />`
- `Table.vue` → `<CroutonTable />`

## Collection Config Pattern

```typescript
// app.config.ts
export default defineAppConfig({
  croutonCollections: {
    products: {
      layer: 'shop',
      kind: 'data',           // 'data' (default) | 'content' | 'media' — controls sidebar grouping
      apiPath: '/api/teams/{teamId}/products',
      container: 'slideover', // 'slideover' | 'modal' | 'dialog' | 'inline'
      references: { categoryId: 'categories' }, // Auto-refresh on mutation
      dependentFieldComponents: { slots: 'SlotPicker' },
      display: { title: 'name', subtitle: 'category', image: 'coverImage', badge: 'status' },
      publishable: true, // Auto-registers as page type in crouton-pages
      // Optional: describe the derived page type shown in the pages editor's
      // page-type picker (name/description are i18n keys; icon falls back to
      // adminNav.icon, then a generic file icon). See crouton-pages CLAUDE.md.
      pageType: { description: 'shop.products.pageType.description', icon: 'i-lucide-shirt' }
    }
  }
})
```

## API Patterns

- **Team-scoped**: `/api/teams/[id]/{collection}/*`
- **Super admin**: `/api/super-admin/{collection}/*`
- **Fetch strategies**: `?ids=` (query) or `/{id}` (RESTful)

## Cache Keys

```
collection:{name}:{queryJSON}     # List queries
collection-item:{name}:{id}       # Single items
```

Mutations invalidate ALL cache keys for the collection.

## Server Pagination

`useCollectionQuery` has opt-in server pagination that pairs with the generated
paginated GET endpoint (`?page=&pageSize=` → `{ items, total, page, pageSize }`).

```ts
const { items, page, pageSize, total, pageCount, paginationData, setPage }
  = await useCollectionQuery('salesPrintqueues', {
    query: computed(() => ({ eventId })),   // FK filters still apply
    pagination: { pageSize: 10 }             // or `true` for the default 10
  })
```

- `page`/`pageSize` are writable refs folded into the request query (changing `pageSize`
  resets to page 1). They become part of the cache key, so each page caches separately.
- `total` prefers the server's `{ total }`, falling back to array length (so it also works
  against a non-paginated endpoint). `pageCount = ceil(total / pageSize)`.
- `paginationData` is shaped for `<CroutonCollection :pagination-data>` and is `null` when
  pagination is off. Helpers: `setPage` (clamped), `nextPage`, `prevPage`.

Wire it into any layout (`table`, `list`, `grid`) — `Collection.vue` renders
`CroutonTablePagination` and emits `update:page` / `update:pageCount`:

```vue
<CroutonCollection
  layout="list" collection="salesPrintqueues" :rows="items"
  server-pagination :pagination-data="paginationData"
  @update:page="page = $event" @update:page-count="pageSize = $event" />
```

Note: `CroutonTablePagination`'s `page-count` prop is the **page size** (rows per page),
not the number of pages.

## Hooks

```typescript
// Listen for mutations (for event tracking)
useNuxtApp().hook('crouton:mutation', ({ operation, collection, itemId, data }) => {
  // operation: 'create' | 'update' | 'delete' | 'move' | 'reorder'
})
```

## Keyboard Shortcuts

Power-user keyboard shortcuts via `useCroutonShortcuts()`:

| Action | Mac | Windows | Context |
|--------|-----|---------|---------|
| Create | `⌘N` | `Ctrl+N` | When no form open |
| Save | `⌘S` | `Ctrl+S` | When form open |
| Close | `Esc` | `Esc` | Closes form/modal |
| Delete | `⌘⌫` | `Ctrl+Backspace` | With selection |
| Search | `⌘K` or `/` | `Ctrl+K` or `/` | Focus search |

```typescript
// Basic usage
const searchRef = ref<HTMLInputElement | null>(null)
const selected = ref<string[]>([])

const { formatShortcut } = useCroutonShortcuts({
  collection: 'posts',
  selected,
  searchRef,
  handlers: {
    onSave: () => formRef.value?.submit(),
    onDelete: (ids) => confirmDelete(ids),
  }
})

// Display shortcut hints
<UButton>New <CroutonShortcutHint :shortcut="formatShortcut('create')" subtle /></UButton>
```

## Built-in Redirects Collection

Core includes a built-in `croutonRedirects` collection for managing URL redirects from the admin panel. Auto-registered via `app/app.config.ts`.

**Fields:** `fromPath`, `toPath`, `statusCode` (301/302), `isActive` (boolean)

**Server middleware** (`server/middleware/redirects.ts`) runs on every request, skips `/api/`, `/admin/`, `/_nuxt/`, `/auth/` paths, and performs exact path matching against cached active redirects.

**Cache** (`server/utils/redirectCache.ts`) loads all active redirects into memory on first request. Invalidated automatically on create/update/delete via the API.

**App setup:** The redirects schema is auto-discovered by NuxtHub via `server/db/schema.ts` in the crouton-core layer — no manual schema export needed. Apps just need to run `db:generate` and `db:migrate` to create the table.

## Common Tasks

### Add a stub for an optional package's component

When a core component optionally uses a component from an addon package (e.g. `crouton-assets`, `crouton-maps`):

1. Create `app/components/stubs/{ComponentName}.vue` — no-op, accepts same props/emits
2. No nuxt.config.ts change needed — the stubs dir is already registered with `priority: -1`
3. The addon package's real component (registered at default priority 0+) automatically overrides it
4. For conditional rendering with a fallback, detect via `useCroutonApps().hasApp('packageId')`
   - The addon package must register itself in `croutonApps` in its `app/app.config.ts`

```vue
<!-- stubs/CroutonFooPicker.vue -->
<script setup lang="ts">
defineProps<{ modelValue?: string }>()
defineEmits<{ 'update:modelValue': [string] }>()
</script>
<template><!-- stub: overridden by @fyit/crouton-foo --></template>
```

```typescript
// Consumer component
const { hasApp } = useCroutonApps()
const hasFoo = hasApp('foo')  // true when crouton-foo is installed
```

**Never use** `resolveComponent()` or `vueApp._context.components` for optional detection.

### Add routes to an existing app's sidebar section

Use `parentApp` to group your layer's routes under an existing app:

```typescript
// layers/my-feature/app/app.config.ts
export default defineAppConfig({
  croutonApps: {
    myFeature: {
      id: 'myFeature',
      parentApp: 'triage',  // Groups under Triage sidebar section
      name: 'My Feature',
      icon: 'i-lucide-star',
      adminRoutes: [
        { path: '/my-feature', label: 'My Feature', icon: 'i-lucide-star' }
      ],
      dashboardRoutes: [],
      settingsRoutes: [],
    }
  }
})
```

This avoids defu array merge conflicts — each layer has its own unique key.
Routes from child apps are automatically included in the parent's sidebar group.

### Add a new composable
1. Create file in `app/composables/use{Name}.ts`
2. Export function with `use` prefix
3. Auto-imported globally

### Add a new component
1. Create file in `app/components/{Name}.vue`
2. Use `<script setup lang="ts">`
3. Auto-imports as `Crouton{Name}`

### Modify team-auth logic
1. Team auth is now in `@crouton/auth` package
2. Client-side: `useTeamContext()` in this package (gets teamId/teamSlug from route)
3. Server-side: Import from `@crouton/auth/server` (e.g., `resolveTeamAndCheckMembership`)
4. See `packages/nuxt-crouton-auth/CLAUDE.md` for server utilities

### Add collection config option
1. Edit types in `app/composables/useCollections.ts`
2. Handle new option in relevant composables
3. Update type exports

## Dependencies

- **Auto-includes**: `@nuxthub/core`, `@nuxt/ui`, `nuxt-crouton-i18n`, `nuxt-crouton-auth`, `nuxt-crouton-admin`
- **Runtime deps**: `@libsql/client` (required for SQLite - pnpm doesn't hoist from layers)
- **Required by**: App packages (e.g., `crouton-bookings`)
- **Peer deps**: `nuxt ^4.0.0`

## NuxtHub Configuration

The core package includes `@nuxthub/core` with sensible defaults:

```typescript
// Minimum hub config in apps — blob: true comes from crouton-core layer
hub: {
  db: 'sqlite'  // Uses D1 on Cloudflare, local SQLite in dev
}
```

**NuxtHub 0.10+ blob API** (multi-vendor rewrite — `hubBlob()` was removed):
```typescript
// In server routes, blob and ensureBlob are auto-imported from hub:blob
await blob.put(pathname, file, { addRandomSuffix: true })
await blob.serve(event, pathname)
await blob.delete(pathname)
ensureBlob(file, { maxSize: '10MB', types: ['image/png'] })
```

**Override in your app** to use different providers:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: ['@fyit/crouton'],

  hub: {
    db: 'postgresql',  // Use PostgreSQL instead
    kv: true,
    blob: true
  }
})
```

**Deployment**: NuxtHub is multi-vendor - deploy to Cloudflare Workers, Vercel, or any supported provider. See [NuxtHub docs](https://hub.nuxt.com/docs/getting-started/deploy) for deployment options.

## Type Definitions

```typescript
// Key types from app/types/table.ts
type ContainerType = 'slideover' | 'modal' | 'dialog' | 'inline'
type LayoutType = 'table' | 'list' | 'grid' | 'tree' | 'kanban' | 'workspace'
type GridSize = 'compact' | 'comfortable' | 'spacious'
type CroutonItemAction = (action: 'create' | 'update' | 'delete' | 'view', ids?: string[], initialData?: any) => void
interface PaginationData { currentPage, pageSize, totalItems, sortBy, sortDirection }
interface HierarchyConfig { enabled, parentField?, orderField?, pathField? }
```

### Inline Container Mode

When `container: 'inline'` is set in collection config, `CollectionViewer` renders a split-view:
any layout on the left (shrinks to 40%) + `WorkspaceEditor` on the right.

`CollectionViewer` provides `CROUTON_ITEM_ACTION_KEY` via Vue's provide/inject.
All child components (Table, DefaultCard, KanbanColumn, Detail, ItemCardMini, TableHeader)
inject this handler instead of calling `crouton.open()` directly. This allows the container type
to be changed without modifying any layout component.

Components fall back to `crouton.open()` when used outside CollectionViewer (no inject available).
Delete actions always use modal overlay regardless of container type.

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
pnpm build          # Verify build works
```
