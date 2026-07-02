# Nuxt-Crouton: Complete Technical Deep Dive

> ⚠️ **Point-in-time snapshot (kept for history).** Written against a 22-package repo on
> the **Cloudflare Pages**-era deploy and the €5 Atelier-tier product framing. Since then:
> apps deploy to Cloudflare **Workers** (#108/#114), the package count has grown
> (`ls packages/` for the live list), and the product framing has moved on. Read it for
> architecture background, not current facts — current stack/deploy rules live in the root
> `CLAUDE.md`.

## 1. Repository Overview

**Repository**: `FriendlyInternet/nuxt-crouton`  
**License**: MIT  
**Stack**: Nuxt 4 · Nuxt UI 4 · Cloudflare Pages · Drizzle ORM · SQLite/D1 · Better Auth · pnpm workspaces  
**Structure**: Monorepo — 22 packages in `packages/`, apps in `apps/`

The framework generates full-stack Nuxt collections from JSON schemas. A CLI reads schema definitions, produces Drizzle database schemas, typed API endpoints, Vue form/list components, composables, and TypeScript types. Packages extend the framework as Nuxt layers, discovered at build time via a manifest system. At runtime, a hook-based event system enables cross-package communication without hard coupling.

The product vision is **Nuxt Atelier**: an open-source framework (nuxt-crouton) plus a hosted tier (€5/month) where AI generates the code and Atelier is the framework around it. Target: non-technical users running small organizations (yoga studios, bike rental shops, event venues).

---

## 2. Architecture: How It All Fits Together

### 2.1 The Layer Stack

Every nuxt-crouton app is a stack of Nuxt layers. From bottom to top:

1. **crouton** (root module) — Build-time orchestrator. Discovers manifests, resolves layers, injects runtime config.
2. **crouton-core** — Modal/form state, collection registry, mutation system, query system, team context, all shared components.
3. **crouton-auth** — Better Auth integration. Teams, sessions, scoped access, passkeys, 2FA, OAuth.
4. **crouton-i18n** — Database-backed translations, translatable field support.
5. **Feature packages** (bookings, sales, pages, triage, etc.) — Domain-specific collections, composables, components.
6. **Generated layers** — CLI output: per-collection layers with schema, queries, API routes, form, list, composable, types.
7. **App layer** — The actual application, extending everything above.

### 2.2 Build-Time Flow

```
crouton.config.js          →  CLI reads config
  ↓                            ↓
schemas/*.json             →  CLI generates per-collection layers
  ↓                            ↓
crouton.manifest.ts files  →  Root module discovers all manifests
  ↓                            ↓
nuxt.config.ts             →  Layers resolved, merged, app boots
```

The root module (`packages/crouton/src/module.ts`) scans both `packages/crouton-*/crouton.manifest.ts` and `node_modules/@fyit/crouton-*/crouton.manifest.ts`. It uses regex-based metadata extraction (no full TS evaluation) to read `id`, `bundled`, and `category` from each manifest file, then builds the layer list based on bundled status and feature flags in `nuxt.config.ts`.

### 2.3 Runtime Flow

```
User action (create/update/delete)
  ↓
useCollectionMutation()    →  API call with correlation ID
  ↓                            ↓
Server handler             →  Drizzle query → D1/SQLite
  ↓                            ↓
Response                   →  Cache invalidation + toast
  ↓
crouton:mutation hook      →  All listeners notified
  ↓
crouton-events plugin      →  Audit trail written
```

---

## 3. Core Infrastructure

### 3.1 crouton-core

The heart of the framework. Provides all shared primitives that every collection and package depends on.

#### Composables

**`useCrouton()`** — Global UI state manager. Controls the modal/slideover system that drives all CRUD interactions. Supports nested slideovers up to depth 5 (create a booking → create a new location inline → create a new setting inline). Tracks loading states and current action per level.

**`useCollections()`** — Collection registry, populated from `appConfig.croutonCollections` at runtime. Provides a `componentMap` that maps collection names to their generated form components, enabling `FormDynamicLoader.vue` to resolve the right form at runtime. Also maintains a `dependentFieldComponentMap` for fields whose options depend on another field's value.

**`useCollectionMutation()`** — The write path. Every create, update, and delete in the system goes through this composable. It provides type-safe CRUD operations with automatic cache invalidation via `useQueryClient().invalidateQueries()`, generates correlation IDs for request tracing, shows toast notifications on success/failure, tracks reference fields for cascade awareness, and — critically — emits the `crouton:mutation` hook after every operation. This hook is the backbone of cross-package communication.

**`useCollectionQuery()`** — The read path. Data fetching with pagination, filtering, and team context. Built on top of Vue Query for caching and background refetching.

**`useTeamContext()`** — Multi-tenant team resolution. Every API call scopes data to the current team. Team ID flows from auth session through to every database query.

**`useScopedAccess()`** — Lightweight resource-scoped authentication that bypasses full auth for specific use cases: event helper PIN login, guest booking access, temporary attendee access. Sessions stored in localStorage + cookie. Methods: `login()`, `logout()`, `validateSession()`, `refreshSession()`. Convenience wrappers: `useEventAccess()`, `useBookingAccess()`.

#### Components

The component library covers every CRUD surface:

**Data display**: `CroutonTable`, `CroutonKanban`, `CroutonCalendar`, `CroutonTree`, `CroutonDetail`. Each renders collection data with sorting, filtering, and inline actions.

**Cards**: `CroutonCardMini`, `CroutonCardSmall`, `CroutonCard` — Used in reference selects, search results, and compact views. Driven by the schema's `displayConfig` (title, subtitle, image, badge, description fields).

**Forms**: `CroutonForm` (base), `FormDynamicLoader` (resolves generated form by collection name), `FormRepeater` (nested arrays), `FormReferenceSelect` (pick from another collection), `FormDependentFieldLoader` (loads options based on another field's value), `ImageCropper`, `DraggableList`.

**Utilities**: `ExportButton`, `ImportButton`, `ValidationErrorSummary`.

#### The Hook System

The `crouton:mutation` hook is the event bus of the entire framework:

```typescript
interface CroutonMutationEvent {
  operation: 'create' | 'update' | 'delete' | 'move' | 'reorder'
  collection: string
  itemId?: string
  itemIds?: string[]
  data?: Record<string, unknown>
  updates?: Record<string, unknown>
  result?: unknown
  beforeData?: Record<string, unknown>
  correlationId?: string
  timestamp?: number
}
```

Every CRUD operation emits this hook. The `crouton-events` package subscribes to track all mutations to an audit log. Custom plugins can subscribe via `nuxtApp.hooks.hook('crouton:mutation', async (event) => { ... })`. This is the foundation for any future automation system — the "when" trigger side already exists for free.

### 3.2 crouton-auth

107 files. A comprehensive auth system wrapping Better Auth with Nuxt-specific conveniences.

**Authentication methods**: Email/password, OAuth (Google, GitHub, etc.), magic links, passkeys (WebAuthn, disabled on Cloudflare Workers due to `@simplewebauthn/server` incompatibility), two-factor authentication (TOTP).

**Multi-tenancy**: Full team system with roles (owner, admin, member), team switching (`TeamSwitcher` component), member invitations (`MemberInviteForm`), per-team theme settings (color swatches, border radius).

**Scoped access**: Beyond full authentication, the package provides `useScopedAccess()` for lightweight, resource-scoped tokens. This is the primitive that could support a member area concept — it already handles resource-scoped auth with role-based access, session management, and validation.

**Admin features**: Impersonation (`useImpersonation()`), user management, team management, stats dashboard.

**Server middleware**: `resolveTeamAndCheckMembership` — every generated API endpoint imports this to verify the requesting user belongs to the team owning the data. This is a hard dependency: removing crouton-auth breaks every generated endpoint.

### 3.3 crouton-i18n

Database-backed translation system supporting English, Dutch, and French. Translatable fields in schemas generate JSON columns that store `{ en: "...", nl: "...", fr: "..." }`. The package provides team-level and system-level translation management UIs, plus integration with the AI translation system in crouton-ai.

---

## 4. The CLI Code Generation Pipeline

The CLI (`packages/crouton-cli`) is the bridge between declarative JSON schemas and running Nuxt layers. When you run `pnpm crouton config ./crouton.config.js`, it reads the config, iterates over each collection, and generates a complete layer.

### 4.1 What Gets Generated

For each collection, the CLI produces:

**`server/database/schema.ts`** — Drizzle ORM table definition. Includes hierarchy support (parent/path columns), sortable support (sortOrder column), translations field (JSON), metadata fields (createdAt, updatedAt, createdBy, updatedBy), and team fields (teamId, owner). Every table gets `teamId` for multi-tenant scoping.

**`server/database/queries.ts`** — Drizzle query functions: `getAll` (with pagination, filtering, team scoping), `getByIds`, `create`, `update`, `delete`. All queries filter by `teamId` automatically.

**`server/api/teams/[id]/{collection}/`** — Four API routes:
- `index.get.ts` — List with pagination and filters
- `index.post.ts` — Create with hierarchy path calculation
- `[itemId].patch.ts` — Update
- `[itemId].delete.ts` — Delete

Each route imports `resolveTeamAndCheckMembership` from crouton-auth. Optional: `reorder.patch.ts` for sortable collections, `[itemId]/move.patch.ts` for hierarchical collections.

**`app/components/_Form.vue`** — Vue form component. Includes an AI context header comment describing the collection and its fields (for AI assistants working on the code). Field grouping, translatable field support, custom component resolution, validation rules.

**`app/components/List.vue`** — List view component with table columns derived from schema fields.

**`app/composables/use{Package}{Collection}.ts`** — Collection-specific composable wrapping `useCollectionQuery()` and `useCollectionMutation()` with typed parameters.

**`types.ts`** — TypeScript interfaces for the collection's items.

**Custom field components** — For repeater fields and custom input types, additional Vue components are generated: `{FieldName}/Input.vue`, `{FieldName}/CardMini.vue`, `{FieldName}/Select.vue`.

### 4.2 Schema Capabilities

The JSON schema system is remarkably sophisticated:

**Field types**: text, textarea, number, select, multiselect, checkbox, date, datetime, color, email, url, phone, image, file, reference, repeater, json, richtext, coordinates (GeoJSON).

**Dynamic behavior**:
- `dependsOn` + `dependsOnField` + `dependsOnCollection` — A field's options load dynamically based on another field's current value. Used in bookings: selecting a location loads its available time slots.
- `optionsCollection` + `optionsField` with `creatable: true` — Options come from another collection, and the user can create new options inline without leaving the form.

**Repeaters**: Nested arrays of sub-fields, each with their own type definitions and generated mini-components (Input, CardMini, Select). Used for slot schedules, blocked dates, template variables.

**Display config**: Every collection schema defines `displayConfig` with `titleField`, `subtitleField`, `imageField`, `badgeField`, `descriptionField`. This drives how items appear in cards, selects, and search results across the entire UI.

**References**: `refTarget` points to another collection. Currently uses hard-coded collection names (e.g., `refTarget: "locations"`), not capability-based lookup.

**Hierarchy**: Collections can be hierarchical (parent/children) with path-based tree structure. The CLI generates move endpoints and the core provides `CroutonTree` for display.

**Sortable**: Collections can be drag-and-drop reorderable. The CLI generates reorder endpoints.

**Translatable**: Fields marked as translatable get JSON storage and per-language editing in forms.

**Custom components**: Schema fields can specify custom Vue components (ColorPicker, OpenDaysPicker, ScheduleGrid, etc.) that the package provides and the form resolves at runtime.

---

## 5. The Manifest System

Every package declares its capabilities through a manifest file (`crouton.manifest.ts`). This is the package's contract with the framework.

### 5.1 Manifest Structure

```typescript
defineCroutonManifest({
  id: 'crouton-bookings',
  name: 'Bookings',
  description: 'Booking and reservation system',
  icon: 'i-heroicons-calendar',
  version: '1.0.0',
  category: 'miniapp',               // core | addon | miniapp
  aiHint: 'use when app needs booking/reservation system',
  
  layer: { 
    name: 'bookings', 
    editable: false, 
    reason: 'Package provides its own layer' 
  },
  
  dependencies: ['@fyit/crouton', '@fyit/crouton-auth'],
  
  collections: [
    { name: 'bookings', tableName: 'bookings', description: '...', 
      schema: bookingsSchema, schemaPath: './schemas/booking.json' },
    { name: 'locations', tableName: 'bookingsLocations', description: '...', 
      schema: locationsSchema, schemaPath: './schemas/location.json' },
  ],
  
  configuration: {
    'email.enabled': { type: 'boolean', label: 'Enable email notifications', default: false }
  },
  
  extensionPoints: [
    { collection: 'bookings', allowedFields: ['customData', 'metadata'], 
      description: 'Add custom fields to bookings' }
  ],
  
  provides: {
    composables: ['useCustomerBooking', 'useBookingAvailability'],
    components: ['BookingWizard', 'AvailabilityCalendar'],
    apiRoutes: ['/api/bookings/availability', '/api/bookings/public']
  }
})
```

### 5.2 Categories

- **core**: Foundational packages (crouton, crouton-core, crouton-auth, crouton-i18n). Always included unless explicitly disabled.
- **addon**: Optional infrastructure (crouton-ai, crouton-email, crouton-collab, crouton-maps, crouton-assets, crouton-editor, crouton-events, crouton-pages). Included when enabled in nuxt.config.
- **miniapp**: Domain-specific applications (crouton-bookings, crouton-sales, crouton-triage). Included when enabled.

### 5.3 Discovery and Resolution

At build time, the root module:

1. Scans `packages/crouton-*/crouton.manifest.ts` and `node_modules/@fyit/crouton-*/crouton.manifest.ts`
2. Extracts metadata via regex (id, bundled flag, category)
3. Maps manifest IDs to feature keys: `manifestIdToFeatureKey('crouton-mcp-toolkit')` → `'mcpToolkit'`
4. Checks nuxt.config.ts options to determine which optional packages are enabled
5. Builds the layer list: bundled packages always in, optional packages only when enabled
6. Injects the merged registry into `appConfig.crouton.modules` for runtime access

At runtime, any code can read `appConfig.crouton.modules` to discover what's installed, what collections exist, what composables and components are available. The AI designer uses this to suggest packages based on `aiHint` fields.

### 5.4 Extension Points

Packages declare `extensionPoints` — fields in their collections that apps can extend. For example, bookings declares `customData` and `metadata` fields on the bookings collection. An app can add custom fields there without modifying the package.

This is one-directional: the package defines where extension is allowed, the app fills it in. There's no reverse mechanism (packages discovering what other packages provide).

---

## 6. Package-by-Package Analysis

### 6.1 crouton-bookings

The most complete domain package. A full booking/reservation system.

**Collections**: locations, bookings, settings, email-templates, email-logs.

**Location system**: Two booking modes. *Slot-based*: locations define time slots with capacity, schedule rules (open days, slot schedules as JSON, blocked dates as repeater fields). *Inventory-based*: locations define a quantity available per day, no time slots. The `inventoryMode` boolean on the location schema switches between modes. Custom components: `ColorPicker`, `OpenDaysPicker`, `ScheduleGrid`, `BlockedDateInput`. GeoJSON coordinates for map integration.

**Booking wizard** (`useCustomerBooking()`): A multi-step public-facing flow: select location → pick date → choose slot (or set quantity) → confirm. Validates per step, detects inventory vs slot mode from the selected location, integrates schedule rules, checks availability via `useBookingAvailability()`, prevents double-booking, manages quantity for inventory mode. This is the only public-facing customer UI in the entire framework.

**Availability engine** (`useBookingAvailability()`): Fetches 3 months of availability data. Calculates remaining capacity per slot or per date by subtracting existing bookings from total capacity. `useBookingSlots()` parses slot definitions, filters by schedule rules and blocked dates. `useScheduleRules()` encapsulates the open-days, slot-schedule, blocked-dates logic.

**Email automation** (`server/utils/email-service.ts`): Template-driven email pipeline. Templates define trigger types (booking_created, reminder_before, booking_cancelled, follow_up_after), recipient types (customer, admin, both), and timing offsets (`daysOffset` for reminders). Template variables: `{{customer_name}}`, `{{booking_date}}`, `{{location_title}}`, etc. The service fetches active templates by trigger type, replaces variables, sends via configured provider, and logs every attempt to the email-logs collection. Supports custom email provider registration via `registerEmailProvider()`. Statistics and detail queries available via `getBookingEmailStats()` and `getBookingEmailDetails()`.

**Cross-package pattern**: Bookings optionally depends on crouton-email. Uses dynamic imports with `@vite-ignore` to prevent build-time resolution failure when email isn't installed. Checks `isBookingEmailEnabled()` (reads `config.public.croutonBookings?.email?.enabled`) before all email operations. Falls back gracefully — no emails sent, no errors thrown.

### 6.2 crouton-sales

Event-based point-of-sale system for pop-up events, markets, temporary retail.

**Collections**: events, products, categories, orders, orderItems, locations (prep stations), clients, eventSettings, printers (optional), printQueues (optional).

**POS interface**: `OrderInterface`, `Cart`, `ProductList`, `ProductCard`, `OrderSummary`, `PaymentModal`, `ReceiptPreview`, `PrinterStatus`, `EventSelector`, `CategoryFilter`, `QuickActions`, `HelperLogin`.

**Helper auth**: PIN-based login for volunteers and temporary staff. Uses `useHelperAuth()` — separate from full auth, designed for quick access on shared devices at events.

**Thermal printing**: Optional thermal receipt printing. When `print.enabled` is true in config, the system manages printer connections and print queues. `printers` and `printQueues` collections only exist when printing is enabled.

**Key distinction**: This is NOT invoicing or recurring billing. It's a POS terminal for ephemeral events. The Atelier vision's invoicing needs (membership billing, recurring charges) would require a separate package.

### 6.3 crouton-pages

CMS with a block-based page editor.

**Block system** (`block-registry.ts`): Registered block types: `heroBlock`, `sectionBlock`, `ctaBlock`, `cardGridBlock`, `separatorBlock`, `richTextBlock`, `collectionBlock`. Each block has: type, name, description, icon, category, default attributes, and a schema defining its editable properties. The editor uses Tiptap with custom extensions for each block type.

**Page types** (`usePageTypes()`): This composable aggregates page types from all registered packages. Crucially, it auto-derives page types from publishable collections — any collection with `publishable: true` in its schema automatically becomes a page type, rendered via `CroutonPagesCollectionPageRenderer`. Page types are grouped by category and originating package.

This is the closest thing to a "surface" concept in the current codebase. Packages contribute page types, collections can be published as pages. But it's limited to public-facing pages — there's no equivalent for admin views or member areas.

**Components**: `BlockEditor`, `BlockEditorWithPreview`, `BlockPropertyPanel`, `BlockToolbar`, `Renderer`, `CollectionPageRenderer`, `Nav`, `Workspace` (with `Editor`, `Sidebar`, `EmptyState` sub-components).

### 6.4 crouton-triage

Discussion-to-task pipeline. Ingests discussions from multiple sources, analyzes them with AI, and creates tasks.

**Adapter pattern** (`server/adapters/base.ts`): A clean abstraction for discussion sources:

```typescript
interface DiscussionSourceAdapter {
  parseIncoming(payload: unknown): ParsedDiscussion
  fetchThread(threadId: string, config: SourceConfig): Promise<Thread>
  postReply(threadId: string, message: string, config: SourceConfig): Promise<void>
  updateStatus(threadId: string, status: string, config: SourceConfig): Promise<void>
  validateConfig(config: SourceConfig): ValidationResult
  testConnection(config: SourceConfig): Promise<ConnectionTestResult>
}
```

Implementations: Figma (email-based), Slack (webhook-based), Notion (webhook-based). All produce standardized `ParsedDiscussion` output.

**Processing pipeline** (`server/services/processor.ts`): Six stages:
1. **Validation** — Check required fields on incoming discussion
2. **Config loading** — Load source configuration (API keys, webhook URLs)
3. **Thread building** — Fetch complete thread via adapter or use direct input
4. **AI analysis** — Send to Claude for summary generation and task detection
5. **Task creation** — Create tasks in Notion via API
6. **Notification** — Update source status, send confirmations

**Domain routing** (`server/utils/domain-routing.ts`): Routes detected tasks to appropriate outputs based on domain keywords, user mappings, and auto-matching rules. A task about "design" routes to the design team's board; a task about "engineering" routes to the engineering backlog.

### 6.5 crouton-designer

AI-powered app scaffolding wizard. This is the current "builder" — a chat-based interface where an AI designs your app's data model.

**Four-phase wizard**:

**Phase 1 — Intake**: Chat + config form. AI extracts app configuration: name, appType, multiTenant, authType, languages, packages. The AI uses a `set_app_config` tool to update the config. It suggests packages based on available manifests, using each manifest's `aiHint` field to match user needs.

**Phase 2 — Collection Design**: Chat + collection editor. AI designs collections using CRUD tools: `create_collection`, `add_field`, `update_field`, `delete_field`, `reorder_fields`. The prompt (`useCollectionDesignPrompt()`) enforces best practices: auto-generates standard fields (id, teamId, createdAt, updatedAt), requires display config for every collection, validates field types and relationships.

**Phase 3 — Seed Data**: Chat + data panel. AI generates realistic sample data matching the schema definitions.

**Phase 4 — Review & Create**: Validation pass, then POST to `/api/scaffold-app`. The scaffold endpoint:
1. Runs `scaffoldApp()` from CLI (imported via jiti for ESM/CJS interop)
2. Writes schema files to `schemas/`
3. Writes seed data to `schemas/*.seed.json`
4. Generates `crouton.config.js` with collections and targets
5. Runs `pnpm install` from monorepo root
6. Runs `pnpm crouton config ./crouton.config.js` to generate all layers
7. Runs `doctor()` to validate the output

**Continuous AI session**: Uses `useChat()` from crouton-ai with `maxSteps: 5`. All tools from all phases are provided simultaneously; the system prompt guides which tools to use per phase. Projects persist to the database with auto-save (config: 800ms, seed: 800ms, messages: 1200ms debounce).

**Key distinction**: The designer is a developer tool — a chat wizard for designing database schemas. The Atelier vision's builder is a visual app composer for end users ("yoga studio owner picks packages from a catalog"). The designer could power the builder's backend, but the frontend needs a fundamentally different approach.

### 6.6 crouton-ai

Multi-provider AI infrastructure.

**Composables**: `useChat()` wraps the AI SDK's useChat with crouton defaults, team context integration, tool call extraction, and message persistence. `useCompletion()` for single requests. `useAIProvider()` for provider abstraction. `useTranslationSuggestion()` for AI-powered translation suggestions in the i18n workflow.

**Server**: Provider factory in `server/utils/ai.ts` with streaming support. Implementations for Anthropic (Claude) and OpenAI. Unified provider interface in `providers/types.ts`.

**Components**: `Chatbox`, `Message`, `Input`, `AITranslateButton`.

**Editor integration**: Tiptap extension for inline AI translation suggestions.

### 6.7 crouton-collab

Real-time collaboration using Yjs CRDTs and Cloudflare Durable Objects.

**Architecture**: Each collaborative document gets a `CollabRoom` Durable Object on Cloudflare. Clients connect via WebSocket. Yjs handles conflict-free merging of concurrent edits. Presence tracking shows who's editing what.

**Composables**: `useCollabConnection()` (WebSocket lifecycle), `useCollabEditor()` (Yjs-aware Tiptap editor), `useCollabPresence()` (who's online, cursor positions), `useCollabSync()` (document synchronization), `useCollabLocalizedContent()` (collaborative editing of translated content), `useFormCollabPresence()` (field-level presence indicators in forms).

**Components**: `CollabCursors` (colored cursors), `CollabEditingBadge`, `CollabIndicator`, `CollabPresence`, `CollabStatus`.

**Plugins**: `collection-sync.client.ts` and `form-collab.client.ts` — auto-initialize collaboration for collections and forms.

### 6.8 crouton-flow

Visual node graph editor with real-time sync. Built on Vue Flow + Yjs.

**Composables**: `useFlowData()`, `useFlowLayout()`, `useFlowMutation()`, `useFlowPresence()`, `useFlowSync()`.

**Components**: `Flow`, `Node`, `GhostNode`, `FlowConnectionStatus`, `FlowPresence`.

**Server**: `FlowRoom` Durable Object for real-time sync, WebSocket routes.

Currently used for visual workflow design. Could be the foundation for a visual automation builder.

### 6.9 crouton-events

Audit trail system. Listens to every `crouton:mutation` hook and records it.

**Plugin** (`event-listener.ts`): Subscribes to `crouton:mutation`, tracks all CRUD operations with before/after data, correlation IDs, timestamps.

**Composables**: `useCroutonEventTracker()`, `useCroutonEvents()`, `useCroutonEventsExport()`, `useCroutonEventsHealth()`.

**Components**: `ActivityLog`, `ActivityTimeline`, `ActivityTimelineItem`, `EventChangesTable`, `EventDetail`, `ActivityFilters`.

**Health tracking**: Total attempts, failed attempts, last error. Useful for monitoring the reliability of the event system.

This package is the **automation foundation**. It already captures every mutation in the system. Combining it with the flow package could produce a visual automation builder where users define "when X happens in collection Y, do Z."

### 6.10 crouton-email

Email infrastructure using Vue Email templates and Resend as the sending provider.

**Server utilities**: `email.ts` (send function), `senders.ts` (sender configuration), `template-renderer.ts` (Vue Email → HTML rendering).

**Templates**: `MagicLink`, `PasswordReset`, `TeamInvite`, `Verification`, `Welcome`, `BaseLayout`.

**Components**: `Input` (email input field), `MagicLinkSent`, `ResendButton`, `VerificationFlow`.

### 6.11 crouton-maps

Mapbox GL JS integration for location-aware collections.

**Components**: `Map`, `Marker`, `Popup`, `Preview`.

**Composables**: `useGeocode()`, `useMap()`, `useMapConfig()`, `useMapboxStyles()`, `useMarkerColor()`.

Integrates with the GeoJSON coordinates field type in schemas. Used by bookings for location mapping.

### 6.12 crouton-assets

Media library backed by NuxtHub blob storage (Cloudflare R2).

**Components**: `Picker` (browse and select), `Uploader` (drag-and-drop upload).

**Composable**: `useAssetUpload()` — handles upload lifecycle, progress tracking, blob storage integration.

### 6.13 crouton-editor

Rich text editing via Tiptap.

**Components**: `Simple` (basic formatting), `WithPreview` (side-by-side preview), `Blocks` (block-style editing), `Preview` (read-only render), `Variables` (template variable insertion).

**Composable**: `useEditorVariables()` — manages available variables for template editing (used in email templates).

### 6.14 crouton-admin

Super admin dashboard for platform operators.

**Components**: `Dashboard`, `StatsCard`, `TeamList`, `UserList`, `UserActions`, `ImpersonationBanner`, `TeamThemeSettings` (with `ColorSwatchPicker`, `RadiusPicker`).

**Composables**: `useAdmin()`, `useAdminStats()`, `useAdminTeams()`, `useAdminUsers()`, `useImpersonation()`, `useTeamTheme()`.

**Features**: Platform-wide stats, user management, team management, impersonation (log in as any user for debugging), per-team theme customization (color swatches and border radius).

### 6.15 crouton-themes

Swappable UI theme system.

**Available themes**:
- **KO theme**: Hardware-inspired aesthetic with LED indicators, knobs, panels, punch holes, speaker grills
- **KR11 theme**: Drum machine aesthetic
- **Minimal theme**: Clean, standard UI

**Component**: `ThemeSwitcher` — lets users swap between installed themes.

### 6.16 crouton-mcp

Standalone MCP (Model Context Protocol) server that wraps CLI tools for external AI agent access.

**Tools**: `cli-help`, `design-schema`, `dry-run`, `generate`, `init-schema`, `list-collections`, `rollback`, `validate-schema`.

Designed for use with Claude Desktop, Cursor, or any MCP-compatible AI client. Lets an AI agent run CLI commands against the codebase.

### 6.17 crouton-mcp-toolkit

Nuxt module that exposes a running app's data via MCP.

**Resources**: `collection-schema`, `collections-registry`.

**Tools**: `create-item`, `delete-item`, `get-item`, `list-collections`, `list-items`, `update-item`.

**Prompts**: `data-entry`.

Where crouton-mcp wraps the CLI (design-time), crouton-mcp-toolkit wraps the live app (runtime). An AI agent can query, create, and modify data in a running crouton app.

### 6.18 crouton-devtools

Nuxt Devtools integration. Auto-enabled in development mode. Provides collection inspection, schema viewing, and debugging tools within the Nuxt Devtools panel.

---

## 7. Cross-Package Communication Patterns

The framework uses five distinct patterns for packages to interact:

### Pattern 1: Direct Import (Hard Dependency)

When a package requires another package. The generated API endpoints all do this:

```typescript
import { resolveTeamAndCheckMembership } from '@fyit/crouton-auth/server/utils/team'
```

This creates a hard coupling. Removing crouton-auth breaks every generated endpoint.

### Pattern 2: Dynamic Import with @vite-ignore (Optional Dependency)

When a package can use another package but doesn't require it:

```typescript
const { bookingsEmailtemplates } = await import(/* @vite-ignore */ schemaPath)
```

The `@vite-ignore` prevents Vite from trying to resolve the import at build time. If the module isn't available at runtime, the import fails and the calling code handles it gracefully.

### Pattern 3: Runtime Config Check (Feature Detection)

Feature flags read from runtime config:

```typescript
const isEmailEnabled = computed(() => {
  return config.public.croutonBookings?.email?.enabled === true
})
```

Packages check whether a feature is enabled before attempting to use it. Combined with Pattern 2, this allows fully optional dependencies.

### Pattern 4: Provider Registration (Inversion of Control)

Packages define interfaces; apps provide implementations:

```typescript
// In crouton-bookings: defines the interface
registerEmailProvider({
  async send({ to, subject, html, from }) { /* ... */ }
})
```

The app or another package registers a concrete provider. The consuming package calls the interface without knowing the implementation.

### Pattern 5: Hook Subscription (Event-Driven)

Loose coupling through the Nuxt hook system:

```typescript
nuxtApp.hooks.hook('crouton:mutation', async (event) => {
  await track(event)
})
```

Any package can emit or subscribe to hooks. The emitter doesn't know who's listening. The listener doesn't know who emitted. This is the most decoupled pattern and the foundation for automation.

---

## 8. Real App: bike-sheds

The `apps/bike-sheds` directory shows how a real application uses the framework.

**nuxt.config.ts extends**: crouton-core, crouton-i18n, crouton-editor, crouton-maps, crouton-pages, crouton-bookings, plus two local layers (`./layers/bookings`, `./layers/pages`).

**Infrastructure**: NuxtHub with SQLite + KV. Cloudflare Pages deployment. Email enabled. Passkeys disabled (Cloudflare Workers incompatibility — stubs `@better-auth/passkey`, `@simplewebauthn/server`, and several Node.js polyfills).

**Generated layers**: The `layers/bookings` directory contains CLI-generated collections for bookings, locations, and settings. Each has the full generated stack: schema, queries, API routes, form component, list component, composable, types. Custom field components for blocked dates, slots, groups, and statuses.

**The layers/pages layer**: Generated collection for pages with hierarchy support (tree structure, move endpoint, reorder endpoint).

**Localization**: All three languages (EN, NL, FR) with translation files in both `i18n/locales/` and `locales/` directories per layer.

This app demonstrates the full stack: framework packages provide capabilities, CLI generates the data layer, the app ties it all together with configuration.

---

## 9. Gap Analysis: Repo vs. Atelier Vision

### 9.1 Where the Repo Is Ahead

**Schema system**: Far more sophisticated than the vision describes. Repeaters, conditional fields, dynamic options, custom components, display config, hierarchy, sortable, translatable. Production-ready.

**Triage package**: Complete discussion-to-task pipeline with adapter pattern, AI analysis, domain routing. Nothing in the vision describes this — it's a bonus capability.

**Real-time collaboration**: Yjs CRDTs with Cloudflare Durable Objects. Production-grade collaborative editing. The vision doesn't mention real-time collab.

**MCP integration**: Both design-time (CLI wrapping) and runtime (live app data) MCP servers. Forward-looking AI agent integration.

**Flow package**: Visual node graph editor with real-time sync. Potential automation builder foundation.

**Assets and maps**: Media library and map integration are working and integrated with the schema system.

**Audit trail**: Complete mutation tracking with health monitoring and export capabilities.

### 9.2 Critical Gaps

**Capability-based relations** (BIGGEST GAP): The vision says packages relate through capabilities — "contactable," "bookable" — never naming other packages. The repo uses explicit package dependencies and hard-coded collection references (`refTarget: "locations"`). Extension points exist but are one-directional. Missing entirely: `requires` declarations using capability names, a resolution layer that matches capabilities at runtime, schema references using capability-based lookup instead of collection names.

**Contacts as hub**: No contacts package. Auth manages users and teams, but there's no CRM-like contact system. Bookings stores customer info inline (name, email, phone on the booking record) instead of referencing a shared contact. This is the most important missing package for the Atelier story — contacts should be the entity that ties bookings, invoices, memberships, and communications together.

**Surface system**: The vision describes three surfaces: public website, admin dashboard, member area. The repo has: public pages (crouton-pages), admin views (generated forms/lists), but no unified surface abstraction. Packages can't declare "I contribute a widget to the member area dashboard." The page types system in crouton-pages is the closest analog but only covers public pages.

**Consumer-facing builder**: The designer is an AI chat wizard that produces database schemas — a developer tool. The Atelier vision's builder is a visual app composer where a yoga studio owner picks packages from a catalog, answers guided questions, and gets a working app. The designer's backend (AI + scaffolding) could power this, but the frontend needs to be rebuilt from scratch for non-technical users.

**Graceful degradation**: The vision says removing a package makes the app simpler, never broken. The repo has hard dependencies everywhere — removing crouton-auth breaks every generated endpoint. No fallback mechanisms, no capability resolution that adapts when packages are missing.

**Invoicing**: crouton-sales is a POS terminal for events (products, orders, thermal printers). The vision needs invoicing for recurring membership billing, payment processing, subscription management. These are fundamentally different systems.

**Member area**: No member-facing portal. Scoped access (`useScopedAccess()`) provides the authentication primitive, but there's no "my bookings," "my invoices," or member dashboard. The booking wizard is public-facing, not member-facing.

### 9.3 Bridging the Gaps

The repo has strong foundations for closing each gap:

- **Capabilities**: The manifest system already declares collections, provides, and extension points. Adding `requires: ['contactable']` and `provides: ['bookable']` to manifests, plus a resolution layer in the root module, would bridge this.
- **Contacts**: A new `crouton-contacts` package providing `contactable` capability. Other packages reference contacts through the capability, not by name.
- **Surfaces**: Extend the page types pattern. Each surface (public, admin, member) gets a registry. Packages contribute widgets/pages to surfaces via manifests.
- **Builder**: Layer a visual UI over the designer's AI + scaffolding backend. Replace chat with guided forms, package catalog, and visual preview.
- **Degradation**: Replace hard imports of crouton-auth with dynamic imports + feature detection (Pattern 2 + Pattern 3). The booking email integration already demonstrates this pattern.
- **Invoicing**: New package. Distinct from crouton-sales. References contacts via capability.
- **Member area**: Extend scoped access into a full member portal with "my X" views contributed by packages.

---

## 10. Architectural Patterns Worth Noting

### 10.1 The Generation-First Philosophy

The framework doesn't try to be a generic CRUD engine at runtime. Instead, it generates specific code for each collection at build time. This means:

- Generated code is readable, debuggable, and modifiable
- No runtime schema interpretation overhead
- AI assistants (via MCP or direct code access) can understand and modify generated code
- Type safety is complete: TypeScript knows every field, every route, every query

The trade-off: changes to a schema require re-running the CLI. There's no live schema editing at runtime (though the designer provides a design-time equivalent).

### 10.2 Team-Scoped Everything

Multi-tenancy is baked in at the deepest level. Every generated table has `teamId`. Every generated query filters by team. Every generated API route calls `resolveTeamAndCheckMembership`. This isn't an afterthought — it's a core architectural constraint that makes the framework suitable for SaaS applications where multiple organizations share infrastructure.

### 10.3 The Email Automation Pattern

The bookings package's email system is a miniature automation engine: trigger-based execution (on booking create, cancel, reminder, follow-up), template variable substitution, recipient routing, timing offsets, execution logging, and graceful degradation when email isn't configured. This pattern could be generalized into a cross-package automation system.

### 10.4 Schema as Single Source of Truth

The JSON schema drives everything: database tables, API routes, forms, lists, types, display cards, search results, AI context headers in generated code, and even the designer's understanding of what fields exist. The schema is truly the single source of truth for a collection's shape and behavior.

---

## 11. File Reference

| Path | Description |
|------|-------------|
| `packages/crouton/src/module.ts` | Root module — manifest discovery, layer resolution |
| `packages/crouton-core/app/composables/` | Core composables (useCrouton, useCollections, useCollectionMutation, etc.) |
| `packages/crouton-core/app/components/` | Core components (Table, Form, Tree, Kanban, Calendar, Card, etc.) |
| `packages/crouton-core/crouton-hooks.d.ts` | Hook type definitions (crouton:mutation) |
| `packages/crouton-cli/lib/generators/` | All code generators (schema, queries, API, form, list, composable, types) |
| `packages/crouton-auth/app/composables/useScopedAccess.ts` | Lightweight resource-scoped auth |
| `packages/crouton-bookings/schemas/` | Booking, location, email-template, email-log schemas |
| `packages/crouton-bookings/server/utils/email-service.ts` | Email automation pipeline |
| `packages/crouton-bookings/app/composables/useCustomerBooking.ts` | Multi-step booking wizard |
| `packages/crouton-pages/app/utils/block-registry.ts` | CMS block type registry |
| `packages/crouton-pages/app/composables/usePageTypes.ts` | Page type aggregation from packages |
| `packages/crouton-triage/server/adapters/base.ts` | Discussion source adapter interface |
| `packages/crouton-triage/server/services/processor.ts` | 6-stage processing pipeline |
| `packages/crouton-designer/app/composables/useIntakePrompt.ts` | AI intake phase prompt |
| `packages/crouton-designer/app/composables/useCollectionDesignPrompt.ts` | AI collection design prompt |
| `packages/crouton-designer/server/api/scaffold-app.post.ts` | Scaffold endpoint (CLI integration) |
| `packages/crouton-ai/app/composables/useChat.ts` | AI chat with tool support |
| `packages/crouton-collab/` | Real-time collaboration (Yjs + Durable Objects) |
| `packages/crouton-flow/` | Visual node graph editor |
| `packages/crouton-events/app/plugins/event-listener.ts` | Mutation audit trail listener |
| `apps/bike-sheds/` | Reference app using bookings + pages |
