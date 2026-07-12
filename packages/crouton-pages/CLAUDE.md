# CLAUDE.md - @fyit/crouton-pages

## Package Purpose

CMS-like page management system for Nuxt Crouton. Provides:
- Page types from app packages (Bookings, Sales, etc.)
- Tree/sortable layout for page ordering in admin
- Public page rendering at `/[team]/[slug]`
- Regular pages with rich text editor content
- App-specific page types (e.g., Booking Calendar)
- **Custom domain support** with automatic team resolution

## Key Files

| File | Purpose |
|------|---------|
| `app/composables/usePageTypes.ts` | Aggregate page types from apps + publishable collections |
| `app/composables/useDomainContext.ts` | Custom domain detection and context |
| `app/composables/useNavigation.ts` | Build navigation from published pages (nested slug paths) |
| `app/composables/usePageLink.ts` | Resolve a page id → canonical public URL; page list for pickers |
| `app/utils/page-path.ts` | Shared nested-URL builder (`buildSlugPath`, `buildPagePath`) — single source of truth |
| `app/composables/usePageBlocks.ts` | Block manipulation utilities |
| `app/composables/useFooterPage.ts` | Fetch singleton footer page for current team |
| `app/composables/useNavPill.ts` | `useCroutonNavPill()` — the **floating-nav action slot**. A shared-state registry (`crouton:navPillActions`, same cross-layer decoupling as `crouton:themePreferenceItems`) any package pushes icon buttons into: `register(action)` → unregister fn; `visibleActions` (filtered by reactive `show`, `order`-sorted). Register **client-side** (actions carry functions — not SSR-serializable). `Nav.vue` renders them in both pills; the pages package is the first consumer (the edit-page pencil, registered in `[...slug].vue`) |
| `app/components/Renderer.vue` | `CroutonPagesRenderer` - Renders page based on type |
| `app/components/CollectionPageRenderer.vue` | `CroutonPagesCollectionPageRenderer` - Bridge for publishable collection pages |
| `app/components/RegularContent.vue` | `CroutonPagesRegularContent` - Rich text content display |
| `app/components/BlockContent.vue` | `CroutonPagesBlockContent` - Block-based content display. **Lazy-resolves every block renderer** (`getLazyBlockComponent` → `Lazy{Name}`) so each renderer is a per-block code-split chunk, loaded only when a page contains that block type; SSR markup is preserved (async components resolve server-side, so first paint/LCP is unaffected). |
| `app/components/Footer.vue` | `CroutonPagesFooter` - Self-contained footer for layouts (uses UFooter) |
| `app/components/FooterRenderer.vue` | `CroutonPagesFooterRenderer` - Footer page renderer (used by Renderer.vue) |
| `app/components/Editor/BlockEditor.vue` | Block-based page editor |
| `app/components/Editor/Toolbar.vue` | `CroutonPagesEditorToolbar` - Slim editor action bar: Status + Visibility + a Settings button (emits `show-settings`) on the left, action group (AI/preview/open/delete/save) on the right. All page config moved to SettingsPanel. |
| `app/components/Editor/SettingsPanel.vue` | `CroutonPagesEditorSettingsPanel` - Roomy page-settings slideover (built on core's `CroutonFormExpandableSlideOver`). Sections: General (page type, parent), Appearance (layout), Navigation (in-menu + chrome toggles), Access (scoped access code). Owns no state — re-emits the same `update:*` events the old toolbar popover did. |
| `app/components/Editor/LayoutPicker.vue` | `CroutonPagesEditorLayoutPicker` - Visual layout selector: a grid of selectable cards (wireframe thumbnail + icon + label + description) over `layoutOptions`. Emits `update:modelValue` + `layout-change`. |
| `app/components/Editor/PageTypePicker.vue` | `CroutonPagesEditorPageTypePicker` - Vertically-stacked radio selector for page type (icon + name + description). Options come from `usePageTypes()` (descriptions are package-authored i18n keys in `app.config` pageTypes). |
| `app/components/Form.vue` | Page creation/editing form |
| `app/types/blocks.ts` | Block type definitions |
| `app/utils/block-registry.ts` | Block definitions and schemas |
| `app/components/Blocks/Properties/ImageEditor.vue` | Image property editor for block panel (upload, URL, preview) |
| `app/utils/content-detector.ts` | JSON vs HTML content detection |
| `app/editor/extensions/page-blocks.ts` | TipTap extensions bundle |
| `app/pages/[team]/[...slug].vue` | Public page catch-all route |
| `server/plugins/single-team-rewrite.ts` | Config-driven single-team URL rewriter (Nitro plugin) |
| `server/plugins/domain-resolver.ts` | Resolves custom domains to teams (Nitro plugin) |
| `server/api/teams/[id]/pages.get.ts` | Get published pages for navigation (supports `?pageType=` filter) |
| `server/api/teams/[id]/pages/[slug].get.ts` | Get single page by slug |
| `app/stubs/AIPageGenerator.vue` | Stub for AI page generator (real impl in crouton-ai) |
| `nuxt.config.ts` | Layer configuration |
| `seed/index.ts` | Seed provider + `createPageWithBlocks` helper (`@fyit/crouton-pages/seed`) — injected onto `SeedContext` for block packages |

## Architecture

```
App Package (e.g., Bookings)
    │
    │  registers pageTypes in app.config.ts
    ▼
usePageTypes() composable
    │
    │  aggregates all page types
    ▼
Admin: PageTypeSelector
    │
    │  admin creates page with selected type
    ▼
Database: pagesPages collection
    │
    │  stores page with pageType field
    ▼
Public: /[team]/[...slug].vue
    │
    │  fetches page by slug
    ▼
CroutonPagesRenderer
    │
    ├── pageType === 'core:regular' → CroutonPagesRegularContent
    ├── pageType === 'bookings:calendar' → CroutonBookingsCalendar
    └── pageType === '{layer}:{col}-detail' → CroutonPagesCollectionPageRenderer
                                                  └── Fetches item → resolves {Name}Detail or CroutonDetail
```

## Package + Generated Layer Workflow

The pages system uses a split architecture where the **package provides UI components** and the **generated layer provides the data layer**.

### What the Package Provides

```
packages/nuxt-crouton-pages/
├── app/components/
│   ├── Form.vue          # CroutonPagesForm - admin CRUD form
│   ├── Card.vue          # CroutonPagesCard - tree view card
│   ├── List.vue          # CroutonPagesList - convenience wrapper
│   ├── Renderer.vue      # Public page display
│   └── Editor/, Blocks/  # Block editor components
├── app/pages/
│   └── admin/[team]/pages.vue  # Admin page management route
├── app/composables/      # usePageTypes, useDomainContext, etc.
├── app/app.config.ts     # Registers componentName: 'CroutonPagesForm'
└── server/api/           # Public read APIs
```

### What the Generated Layer Provides

```
apps/{app}/layers/pages/collections/pages/
├── types.ts                          # Generated TypeScript types
├── app/composables/usePagesPages.ts  # Columns, schema, config
├── server/api/.../                   # Admin CRUD APIs
└── server/database/                  # Schema + queries
```

### How Form Resolution Works

1. **Package registers component**: In `app/app.config.ts`:
   ```typescript
   croutonCollections: {
     pagesPages: {
       componentName: 'CroutonPagesForm'
     }
   }
   ```

2. **Admin route uses CroutonCollection**: The package's `/admin/[team]/pages.vue` uses `CroutonCollection` with tree layout

3. **Form resolution**: When user clicks create/edit, `CroutonForm` resolves to `CroutonPagesForm` via the `componentName` registration

4. **Data from generated layer**: The form uses composables and APIs from the generated layer

### Using Pages in a New App

1. **Install package**: Add to `nuxt.config.ts`:
   ```typescript
   extends: ['@fyit/crouton-pages']
   ```

2. **Generate collection**: Create `schemas/pages.json` and run:
   ```bash
   pnpm crouton generate
   ```

3. **Run migrations**:
   ```bash
   pnpm db:migrate
   ```

4. **Use**: Navigate to `/admin/[team]/pages` - package provides the UI

### Important: No Generated Components Needed

The generated layer should **NOT** have a `Form.vue` or `List.vue` - these are provided by the package. If the CLI generates them, they can be deleted. The generated layer only needs:
- `types.ts` - TypeScript types
- `app/composables/usePagesPages.ts` - Columns and schema
- `server/api/` - CRUD APIs
- `server/database/` - Database schema and queries

## Page Type Registration

Apps register page types in `app.config.ts`. **`name`, `description` and `icon`
are all REQUIRED** on `CroutonPageType` (enforced by the type — a registration
missing `description` or `icon` is a TypeScript error). `name`/`description` are
i18n keys (like `CroutonAppConfig.name`), translated at render via `useT()`'s
`t()`; `icon` is a Lucide class (`i-lucide-*`). The page-type picker shows the
`icon` + `name` as the label and the `description` as a one-line explanation
beneath it, so each contributing package owns its own copy in its locale files
(e.g. `bookings.pageTypes.calendar.name` / `.description`). **When you add a new
page type to a package, always supply all three** — they're what make the type
legible in the picker.

```typescript
export default defineAppConfig({
  croutonApps: {
    bookings: {
      id: 'bookings',
      name: 'bookings.title',
      pageTypes: [
        {
          id: 'calendar',
          name: 'bookings.pageTypes.calendar.name',
          description: 'bookings.pageTypes.calendar.description',
          component: 'CroutonBookingsCalendar',
          icon: 'i-lucide-calendar',
          category: 'customer'
        },
        {
          id: 'my-bookings',
          name: 'bookings.pageTypes.myBookings.name',
          description: 'bookings.pageTypes.myBookings.description',
          component: 'CroutonBookingsList',
          icon: 'i-lucide-list',
          requiresAuth: true
        }
      ]
    }
  }
})
```

The core types shipped by this package use the `pages.pageTypes.*` keys (see
`i18n/locales/{en,nl}.json`). `t()` returns the key unchanged when no translation
exists, so the dynamic page types derived from publishable collections (which use
plain-string names) remain safe when piped through `t()`.

## Publishable Collections

Collections with `publishable: true` in their config auto-register as page types at runtime. No manual `croutonApps` registration needed.

**How it works:**
1. `usePageTypes()` scans `croutonCollections` for entries with `publishable: true`
2. For each, it creates a synthetic page type using `CroutonPagesCollectionPageRenderer`
3. The renderer fetches the collection item and resolves `{Name}Detail` or `CroutonDetail`
4. The page form shows a `CroutonFormReferenceSelect` item picker and auto-populates the title

**Example:** A collection `shopBikes` with `publishable: true` creates page type `shop:shopBikes-detail`.

### Describing the derived page type (name / description / icon)

A publishable collection can describe how its derived page type appears in the
page-type picker — the same `name`/`description`/`icon` a package-registered
page type carries — via an optional `pageType` block on the collection config
(typed on `CollectionConfig` in crouton-core). Every field is optional and
falls back gracefully:

```typescript
croutonCollections: {
  shopBikes: {
    publishable: true,
    adminNav: { icon: 'i-lucide-bike' },     // reused as the page-type icon
    pageType: {
      description: 'shop.bikes.pageType.description', // i18n key (or plain text)
      icon: 'i-lucide-bike',                  // overrides adminNav.icon if set
      // name / category optional
    }
  }
}
```

Resolution in `usePageTypes()`:
- **name** → `pageType.name` ?? generated `"{Capitalized Name} Page"`
- **description** → `pageType.description` ?? the generic key
  `pages.pageTypes.collectionDerived.description` (kept as a **raw key** so the
  consumer's `t()` resolves it, like package descriptions)
- **icon** → `pageType.icon` ?? `adminNav.icon` ?? `i-lucide-file-text`

So a publishable collection's page type is never description-less, and picks up
its admin icon automatically. Names/descriptions are passed through `t(value,
value)` at render (Workspace/Editor `pageTypeOptions`), so plain-string names
don't get this app's missing-key `[…]` bracketing.

## usePageTypes() Composable

```typescript
const {
  pageTypes,           // All aggregated page types (apps + publishable collections)
  pageTypesByApp,      // Grouped by source app
  pageTypesByCategory, // Grouped by category
  getPageType,         // Get by fullId (e.g., 'bookings:calendar')
  hasPageType,         // Check if exists
  getDefaultPageType   // Returns 'pages:regular'
} = usePageTypes()
```

## Block-Based Page Editor

The package includes a block-based page editor using TipTap and Nuxt UI page components.

### Block Types

| Block | Component | Purpose |
|-------|-----------|---------|
| `heroBlock` | UPageHero | Title, description, CTA, image |
| `sectionBlock` | UPageSection | Feature grid with icons |
| `ctaBlock` | UPageCTA | Call-to-action banner |
| `cardGridBlock` | UPageGrid + UPageCard | Grid of cards |
| `separatorBlock` | USeparator | Visual divider |
| `richTextBlock` | prose div | Standard text content |
| `qrCodeBlock` | CroutonQrCode | Scannable QR code linking to a CMS page (via the `page` field picker) or a custom URL. Resolves `pageId` → absolute public URL with `usePageLink().resolve()` + `useRequestURL().origin`. |
| `paneBlock` | CroutonLayoutRenderer (render) / CroutonLayout (editor) | **Bridge block (#716, completed #706)** — hosts a *pane layout* inside the document flow. `attrs.layout` is a `LayoutTree` (the "layout is data" shape) + `attrs.height`. Public render delegates to crouton-core's `CroutonLayoutRenderer`; the **in-editor composer** (`Blocks/Views/PaneBlockView.vue`) hosts the editable `CroutonLayout` so authors arrange panes inline. The TipTap node (`editor/extensions/pane-block.ts`) round-trips `attrs.layout` through an editor save (serializes to `data-layout` JSON; JSON content storage preserves the object). The pane tree serializes into the page's existing `content` JSON — no new page type or table. `attrs.layout` is untrusted → `sanitizeLayoutTree` on render; the renderer allowlists each leaf `blockId`. |

### Content Format

Content is stored as JSON in the `content` TEXT column:

```typescript
interface PageBlockContent {
  type: 'doc'
  content: PageBlock[]
}

interface PageBlock {
  type: 'heroBlock' | 'sectionBlock' | 'ctaBlock' | 'cardGridBlock' | 'separatorBlock'
  attrs: Record<string, any>
}
```

### Auto-Detection

The `Renderer.vue` component auto-detects content format:
- **JSON with `type: 'doc'`** → Renders as blocks via `BlockContent.vue`
- **HTML string** → Renders as legacy content via `RegularContent.vue`
- **Empty** → Shows empty state

### Using the Block Editor

```vue
<CroutonPagesEditorBlockEditor
  v-model="content"
  placeholder="Type / to insert a block..."
/>
```

### usePageBlocks() Composable

```typescript
const {
  parse,              // Parse JSON to blocks
  serialize,          // Serialize blocks to JSON
  detectFormat,       // Detect content format
  createEmpty,        // Create empty doc
  fromHtml,           // Convert HTML to blocks
  addBlock,           // Add block to content
  removeBlock,        // Remove block by index
  updateBlock,        // Update block attrs
  moveBlock,          // Reorder blocks
  getAvailableBlocks, // Get block menu items
  getBlockCategories, // Get blocks by category
  getDefinition,      // Get block definition
  getDefaults         // Get default attrs
} = usePageBlocks()
```

### Image Properties in Blocks

Block properties with `type: 'image'` are rendered with `ImageEditor.vue`, which provides:
- Image preview with edit/delete overlay buttons
- Upload via `CroutonImageUpload` (auto-uploads to `/api/upload-image`)
- Direct URL input mode
- Emits image URL string via `v-model`

### Adding Custom Blocks

1. Define type in `app/types/blocks.ts`
2. Add definition in `app/utils/block-registry.ts`
3. Create TipTap extension in `app/editor/extensions/`
4. Create view component in `app/components/Blocks/Views/`
5. Create render component in `app/components/Blocks/Render/`

### Block i18n (`useBlockI18n`)

Block-definition strings (`name`, `description`, field `label`/`description`,
and select-option labels) are translated for the insert menu (`BlockEditor`,
`BlockEditorWithPreview`, `BlockToolbar`) and the property panel
(`BlockPropertyPanel`) via the `useBlockI18n()` composable. It supports two
conventions at once:

- **Addon blocks** (e.g. `@fyit/crouton-sales`) put **explicit i18n keys**
  directly on the definition (`label: 'sales.blocks.…'`).
- **Core blocks** (`block-registry.ts`) keep **plain English** on the
  definition; their translations live under a derived key namespace,
  `pages.blockLibrary.<shortType>.{name,description,fields.<field>.{label,description,options.<value>}}`
  (`shortType` = block type minus the `Block` suffix, e.g. `heroBlock` → `hero`),
  in `i18n/locales/{en,nl,fr}.json`. The English literal in the registry is the
  fallback, so the registry itself is never edited for i18n.

`useBlockI18n` resolves each string by trying the literal value as a key first
(addon keys), then the derived core key, then the original text. **Important:**
this app's `t()` renders a missing key as `[key]`, so values are always passed
with a fallback (`t(value, fallback)`) — never wrap a block string in bare
`t(value)`, or plain English core strings will render bracketed. To translate a
core block, add/extend the `pages.blockLibrary.<shortType>` entry in all three
locale files (keep en/nl/fr at parity).

## Component Naming

Components auto-import with `CroutonPages` prefix:
- `Renderer.vue` → `<CroutonPagesRenderer />`
- `CollectionPageRenderer.vue` → `<CroutonPagesCollectionPageRenderer />`
- `RegularContent.vue` → `<CroutonPagesRegularContent />`
- `BlockContent.vue` → `<CroutonPagesBlockContent />`
- `Footer.vue` → `<CroutonPagesFooter />`
- `FooterRenderer.vue` → `<CroutonPagesFooterRenderer />`
- `Editor/BlockEditor.vue` → `<CroutonPagesEditorBlockEditor />`
- `Editor/Toolbar.vue` → `<CroutonPagesEditorToolbar />`
- `Editor/SettingsPanel.vue` → `<CroutonPagesEditorSettingsPanel />`
- `Editor/LayoutPicker.vue` → `<CroutonPagesEditorLayoutPicker />`
- `Editor/PageTypePicker.vue` → `<CroutonPagesEditorPageTypePicker />`
- `Blocks/Render/HeroBlock.vue` → `<CroutonPagesBlocksRenderHeroBlock />`
- `Blocks/Render/PaneBlock.vue` → `<CroutonPagesBlocksRenderPaneBlock />` (the #716 bridge block — delegates to `CroutonLayoutRenderer`)
- `Blocks/Views/PaneBlockView.vue` → `<CroutonPagesBlocksViewsPaneBlockView />` (the #706 in-editor pane composer — hosts the editable `CroutonLayout`; paired with `editor/extensions/pane-block.ts`)

## URL Structure

- **Public pages**: `/[team]/[locale]/[...slug]` — **nested by hierarchy**. A child
  page lives at its full ancestor chain, e.g. `/acme/en/events/summer-fair`, not
  `/acme/en/summer-fair`. Slugs are unique per team (`UNIQUE (teamId, slug)`), so
  the **last** segment identifies the page; the preceding segments must match its
  ancestor slugs or the lookup 404s (canonical enforcement).
- **Collection binder items**: `/[team]/[locale]/{binder-slug}/{itemId}` — when the
  last segment isn't a page slug, it's treated as a binder item id (binder ids are
  nanoids, so they never collide with human slugs).
- **Admin**: `/admin/[team]/pages` (uses CroutonCollection with tree layout)
- **Homepage**: `/[team]/[locale]/` (first published root page)

**Building URLs:** always go through `app/utils/page-path.ts` (`buildSlugPath` walks
the parentId chain → localized slug path; `buildPagePath` adds team/locale prefix).
The lookup endpoint returns `meta.fullPath` (canonical nested path) for SEO. Used by
`useNavigation`, `usePageLink`, the public render route, and the admin "open in
public" button — keep them all on these helpers so the format never drifts.

### Button Row block — link to a CMS page

`buttonRowBlock` buttons support a **Page** mode alongside Custom URL / Download:
the editor stores the selected page's id in `ButtonRowItem.pageId`, and the renderer
resolves it to the canonical (nested, localized) URL via `usePageLink().resolve()`,
falling back to `to` when the page can't be resolved. Picking a page is hierarchy-
and locale-correct automatically.

### `page` schema field type (reusable page picker)

Block schemas can use `type: 'page'` for any attribute that stores a CMS page id.
`BlockPropertyPanel` renders it as a `USelectMenu` populated from
`usePageLink().pageOptions` (searchable, `{ label, value: pageId }`). The renderer
resolves the stored id via `usePageLink().resolve(pageId)`. Used by `qrCodeBlock`
(its `pageId` attr); reusable by any future block that links to a page.

### Custom property editors can read sibling attrs (`croutonBlockAttrs` provide)

Addon `propertyComponents` editors get only `model-value` + `update:model-value`
from `BlockPropertyPanel`. When an editor needs a SIBLING field of the same
block, the panel **provides** the live editing attrs under the `croutonBlockAttrs`
inject key (the `localAttrs` ref — stable identity, deeply reactive). A custom
editor opts in:

```ts
import type { Ref } from 'vue'
const blockAttrs = inject<Ref<Record<string, unknown>>>('croutonBlockAttrs')
const eventSlug = computed(() => String(blockAttrs?.value?.eventSlug ?? ''))
```

It's purely opt-in (inject) — editors that don't need it are unaffected, and
`inject` returns `undefined` when the component is mounted outside the panel
(degrade gracefully). Used by crouton-sales' `SalesBlocksPropertiesLocationsPicker`
to scope its options to the kitchen-display block's picked `eventSlug` (#119).

## Page Record Schema

```typescript
interface PageRecord {
  id: string
  teamId: string
  title: string
  slug: string
  pageType: string        // 'core:regular' or 'appId:pageTypeId'
  content?: string        // For regular pages (HTML from editor)
  config?: object         // Type-specific settings + page-level flags (see below)
  status: 'draft' | 'published' | 'archived'
  visibility: 'public' | 'members' | 'admin' | 'scoped' | 'hidden'
  showInNavigation: boolean
  parentId?: string       // For hierarchy
  order: number           // For sorting
  path?: string           // Materialized path
  depth?: number          // Nesting level
}
```

### Per-page chrome flags (`config.hideNav` / `config.hideAuthControls`)

Pages can hide pieces of the floating nav on their public render — e.g. a
volunteer-facing kassa page hides the member-login pill so PIN-holding
volunteers can't wander into the team login. Two switches in the editor
toolbar's settings popover write sparse booleans into `config`:

- `hideNav` — hides the page-navigation pill (center/hamburger).
- `hideAuthControls` — hides login button, user avatar, and admin menu. The
  **language switcher and color-mode toggle always stay** in the right pill.

Plumbing: the public route (`[team]/[locale]/[...slug].vue`) publishes the
flags via `useState('pageChrome')` (same pattern as `pageLayout`), `Nav.vue`
consumes it, and the scoped-page 401 payload echoes them as `data.chrome` so
the access gate renders chrome-less too. On regular pages `handleSubmit`
strips config to the page-level keys (`hideNav`, `hideAuthControls`,
`requiredScope`) instead of nulling it — type-specific config still resets
when the page type changes.

### The floating nav pill (`Nav.vue`) — theme quick-select + action slot

The right pill (bottom-left on full-screen pages) hosts the user/admin controls plus:

- **Theme quick-select** — a palette `UDropdownMenu` reading the shared
  `crouton:themePreferenceItems` state (filled by the crouton-themes base layer's
  `themeProvider.client` plugin). Rendered only when that state is populated **and**
  `allowUserThemes || isAdmin`, inside `<ClientOnly>` (no hard dep on crouton-themes;
  hidden entirely when the themes layer isn't extended). Dark-mode toggle stays adjacent.
- **Package action slot** — `useCroutonNavPill().visibleActions` render as ghost icon
  buttons. Any layer contributes via `register()` (see the composable in Key Files). The
  **edit-page pencil** is pages' own contribution: `[...slug].vue` registers it on mount
  (`show: isAdmin && !isEditing && page.id`, `onSelect: startEditing`) — it **replaced the
  old fixed bottom-right FAB**. Client-only registration, so the button appears just after
  hydration.

## Common Tasks

### Add a new page type in your app

1. Add to `pageTypes` array in your app's `app.config.ts`
2. Ensure the component is globally registered
3. The component receives `page` prop with the page record

### Create admin page list

```vue
<CroutonCollection
  collection="pagesPages"
  layout="tree"
  :columns="['title', 'slug', 'pageType', 'status']"
/>
```

### Render a page programmatically

```vue
<CroutonPagesRenderer :page="pageData" />
```

## Scoped Visibility (token-gated pages)

`visibility: 'scoped'` gates a page behind crouton-auth's **scoped access
tokens** — the accountless tokens volunteers/guests get by redeeming a PIN
(see crouton-auth's grants). Team members always pass too (admin preview).

- **Enforcement** lives in the slug endpoint: a valid token whose
  `organizationId` matches the team unlocks the page; otherwise it falls back
  to a team-member session; otherwise 401. The response is sent with
  `Cache-Control: private, no-store` (same pattern as members/admin) so gated
  content never enters the ISR/SWR cache.
- **Derived scope (read-time, never stored)**: on every scoped-page request
  the endpoint parses the content blocks (base `content`, falling back to any
  locale's translations content) and fires the `crouton:pages:derive-scope`
  Nitro hook with `{ teamId, blocks, result }`. Domain plugins may answer via
  the mutable `result` field — the first non-null answer wins (e.g.
  crouton-sales answers `('event', eventId, nameRequired: true)` for an
  embedded `eventWorkspaceBlock`, so the gate redeems the event's helper PIN
  and the kassa adopts that session). Precedence: **derived >
  `config.requiredScope` > `('page', pageId)` fallback**. No answer (block
  removed, resource deleted) ⇒ self-healing fallback to the stored scope /
  page-code gate — no state to drift, no migration. The hook contract lives
  in `server/crouton-hooks.d.ts`.
- **Narrowing**: the page's `config` json may carry
  `{ "requiredScope": { "resourceType": "event", "resourceId": "..." } }` —
  then only tokens scoped to that resource pass (string comparison; pages
  never learns what the resource is). Either key may be omitted. A derived
  scope outranks it (see above).
- **The 401 payload** echoes the effective scope verbatim (including
  `nameRequired`) in `data.scope`, so `ScopedAccessGate.vue` knows what to
  redeem against. The gate redeems via `useScopedAccess(scope.resourceType)`
  — the composable persists a client-readable per-resourceType session
  (`scoped-access-session-${resourceType}`) that embedded surfaces (e.g. the
  kassa) can adopt; the httpOnly `scoped-access-token` cookie keeps its one
  job, the page's SSR check. `scope.nameRequired` makes the gate's name field
  mandatory (whitespace-only rejected — a UX nudge, not a guarantee; the
  endpoint accepts any non-empty name).
- **Editor hint**: when a scoped page's content contains a block whose
  definition carries `providesScope: true` (a `CroutonBlockDefinition` flag —
  the editor only mirrors the server's derivation), the access-code field in
  the toolbar settings popover hides behind a "gated by a block on this page"
  hint — one trust level per page. A pre-existing `('page', pageId)` grant is
  NOT revoked: while the block is present the derived scope wins and the page
  code is inert; remove the block and the page-code gate resumes.
- **Navigation**: the pages list endpoint includes `scoped` pages for team
  members and for anonymous visitors presenting a valid scoped token, so nav
  shows them exactly when they're reachable.
- **Transport**: the token arrives via the canonical `x-scoped-token` header
  or the `scoped-access-token` cookie (set by `useScopedAccess`/redeem/mint —
  the cookie is what makes SSR work).
- **PIN-protect a single page**: create a grant on `('page', pageId)` via
  crouton-auth's `upsertScopedGrant`, set the page's `requiredScope` to match,
  and have the visitor redeem at `/api/auth/scoped-access/redeem`. No domain
  package involved.

## Footer System

The package includes a footer page type (`pages:footer`) that uses the block editor for content and renders inside Nuxt UI's `UFooter` component.

### How It Works

1. Create a page with type "Footer" in the admin — uses block editor
2. `<CroutonPagesFooter />` in the public layout fetches and renders it automatically
3. Renders nothing if no footer page exists — safe to include unconditionally

### useFooterPage() Composable

```typescript
const { footer, content, isLoading, refresh } = useFooterPage()
// footer: raw page record (or null)
// content: localized block content string
```

### Custom Footer Layouts

Apps that need custom footer styling (e.g., branded layouts) can:
1. Use `useFooterPage()` directly and render with their own component
2. Register custom blocks via `croutonBlocks` in `app.config.ts`
3. Or use the default `<CroutonPagesFooter />` which wraps content in `UFooter`

### Page Type Properties

The footer page type uses `hasBlockContent: true` — a flag on `CroutonPageType` that tells the editor to show the block editor for non-regular page types. Also uses `singleton: true` to indicate only one should exist per team.

## Custom Domain Support

The package includes automatic custom domain resolution via server middleware.

### How It Works

```
Custom Domain Request:
booking.acme.com/about
    │
    ▼
01-domain-resolver.ts middleware
    │
    │  looks up 'booking.acme.com' in domain table
    │  finds: organizationId → org with slug 'acme'
    │
    ▼
URL Rewrite: /about → /acme/about
    │
    ▼
Normal routing: [team]/[...slug].vue
```

### useDomainContext() Composable

```typescript
const {
  isCustomDomain,    // Whether request is from custom domain
  isLocaleMode,      // Whether locale routing mode is active
  resolvedDomain,    // The custom domain hostname
  resolvedTeamId,    // Team ID from domain lookup
  hideTeamInUrl,     // true on custom domains OR locale mode
  hostname,          // Current hostname
  isAppDomain        // Whether hostname is known app domain
} = useDomainContext()
```

### useNavigation() Composable

```typescript
const {
  navigation,        // Hierarchical navigation tree
  flatNavigation,    // Flat list of all nav items
  isLoading,         // Loading state
  currentPage,       // Current active page
  isActive,          // Check if nav item is active
  refresh,           // Refresh navigation data
  team               // Current team slug
} = useNavigation()
```

### Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      croutonPages: {
        // Domains to skip (not custom domains)
        appDomains: ['myapp.com', 'staging.myapp.com'],
        // Enable debug logging
        debug: false,
        // Routing mode: 'team' (default) or 'locale'
        routingMode: 'team',
        // Default locale for root redirect in locale mode
        defaultLocale: 'en'
      }
    }
  }
})
```

### Locale Routing Mode

For single-team sites, locale mode removes the team slug from public URLs and lets the app provide its own page routes:
- `/nl/about` instead of `/myteam/nl/about`
- `/` redirects to `/{defaultLocale}/`
- Admin/API/auth routes are unaffected
- crouton-pages does NOT register public page routes — the app provides `[locale]/[...slug].vue`

The server plugin sets `event.context.routingMode = 'locale'` which makes `useDomainContext().hideTeamInUrl` return `true`, so all navigation links automatically omit the team slug.

### Domain Setup

1. Add domain to team in admin (`/admin/[team]/settings/domains`)
2. Add DNS TXT record for verification
3. Verify domain via UI
4. Point domain DNS to your app
5. Requests to that domain automatically resolve to the team

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/teams/[id]/pages` | GET | List published pages (for navigation) |
| `/api/teams/[id]/pages/[slug]` | GET | Get single page by slug |
| `/api/public/[team]/[collection]` | GET | Public collection list (no auth, SWR cached) |
| `/api/public/[team]/[collection]/[itemId]` | GET | Public collection item detail (no auth, SWR cached) |

### Public Collection Endpoints

Collection-binder pages with `visibility: 'public'` and `status: 'published'` automatically expose their bound collection via unauthenticated endpoints. These endpoints:
- Resolve team by slug or ID
- Validate a published public binder exists for the requested collection
- Use the app's generated query registry (`server/utils/crouton-query-registry.ts`) for data access
- Filter items to `status: 'published'` only
- Strip internal fields (`createdBy`, `updatedBy`)
- Cache responses with SWR (5 min)

The `CollectionBinderRenderer` auto-switches to public endpoints when not in `/admin/` and the page visibility is `'public'`.

## Demo Seeding (`@fyit/crouton-pages/seed`)

Part of the composable seeding system (epic #82, contract in
`@fyit/crouton-core/shared/seed`). Exports:

- `createPageWithBlocks(ctx, { slug, locale, title, blocks, visibility, ... })` —
  upserts a `pages_pages` row whose `content` is a `{ type: 'doc', content: blocks }`
  TipTap doc (mirrored into `translations.<locale>.content` and base `content` so
  both the renderer and the scoped-access derive-scope hook see the blocks).
  Idempotent by a stable `seed:page:<team>:<slug>` id. The seed runner injects this
  onto `ctx.createPageWithBlocks`, so a block package (e.g. crouton-sales) can seed
  a demo page only when crouton-pages is present.
- `provider` (id `pages`, `dependsOn: ['auth']`) — seeds crouton-pages' own demo
  page (a plain content page) and materializes any `registerDemoPage(...)` builders.

## Dependencies

- **Extends**: `@fyit/crouton`, `@fyit/crouton-editor`
- **Uses**: Collection tree/sortable for admin page list
- **Uses**: Domain table from `@fyit/crouton-auth`

## Dashboard Deprecation

The pages package replaces the dashboard with a pages-based system:

| Before (Dashboard) | After (Pages) |
|--------------------|---------------|
| `/dashboard/[team]` | `/[team]` (homepage page) |
| `/dashboard/[team]/bookings` | `/[team]/my-bookings` (page type) |
| `/dashboard/[team]/settings/*` | Keep (user settings still valid) |
| Collections in dashboard | Moved to `/admin/[team]/crouton/` |

### Migration

1. Install `nuxt-crouton-pages` layer
2. Generate pages collection: `pnpm crouton generate`
3. Create pages in admin: `/admin/[team]/pages`
4. Enable redirect (optional):

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      croutonPages: {
        redirectDashboard: true // Redirect /dashboard/[team] → /[team]
      }
    }
  }
})
```

### What Stays in Dashboard

- `/dashboard/[team]/settings/*` - User account settings (profile, security)
- Settings are user-focused; admin settings are at `/admin/[team]/settings/`

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
