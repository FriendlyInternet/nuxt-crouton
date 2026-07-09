# CLAUDE.md - @fyit/crouton-atelier

## Package Purpose

Visual app builder for Nuxt Crouton. Users compose apps from pre-defined blocks (booking, pages, auth features) instead of chatting with AI. Blocks are organized on a kanban canvas by visibility (public/members/admin), and the composition is synced in real-time via Yjs.

**Replaces:** `crouton-designer` for the primary app creation flow. Designer's AI chat approach is supplementary; Atelier is the visual block-based approach.

## Key Files

| File | Purpose |
|------|---------|
| `app/types/blocks.ts` | Core types: Block, Template, AppComposition, SelectedBlock, Visibility (importable via `@fyit/crouton-atelier/types`) |
| `app/data/blocks.ts` | Static block declarations (Phase A — bookings, pages, auth) |
| `app/data/templates.ts` | Pre-configured templates (Yoga Studio, Sports Club, Charity, Blank) |
| `app/composables/useBlockRegistry.ts` | Block lookup + filtering (byCategory, byPackage, byVisibility) |
| `app/composables/useAppComposition.ts` | Reactive composition state backed by Yjs Y.Map |
| `app/composables/useAtelierSync.ts` | Wraps useCollabSync for atelier-specific rooms |
| `app/composables/useAtelierScaffold.ts` | Generate flow — builds payload, calls scaffold endpoint |
| `app/components/TemplateSelector.vue` | Full-page template picker (first step) |
| `app/components/BlockCanvas.vue` | Kanban: 3 visibility columns with sortable drag-drop |
| `app/components/BlockPalette.vue` | Block picker grouped by category (sidebar/bottom sheet) |
| `app/components/BlockCard.vue` | Compact block card (draggable, clickable) |
| `app/components/BlockDetail.vue` | Block detail slideover (collection fields) |
| `app/components/IdentityForm.vue` | App name + description inputs |
| `app/components/PackageList.vue` | Auto-derived enabled packages |
| `app/components/GeneratePanel.vue` | Review + generate app slideover |
| `app/components/PresenceIndicator.vue` | Collaborator avatar stack |
| `app/components/Fab.vue` | Mobile floating action button |
| `app/pages/admin/[team]/atelier/index.vue` | Project list (CRUD) |
| `app/pages/admin/[team]/atelier/[id].vue` | Builder page (main orchestrator) |
| `server/api/atelier/scaffold-app.post.ts` | Scaffold endpoint (reuses CLI via jiti) |
| `server/api/atelier/projects/index.get.ts` | List projects API |
| `server/api/atelier/projects/index.post.ts` | Create project API |
| `server/api/atelier/projects/[id].delete.ts` | Delete project API |
| `server/database/schema.ts` | AtelierProject Drizzle table |

## Architecture

```
TemplateSelector → selectTemplate() → Yjs Y.Map populated
                                          ↓
BlockPalette → addBlock() → Y.Map.blocks[] updated → all clients sync
                                          ↓
BlockCanvas (kanban) ← blocksByVisibility (computed)
  ├── Public column (sortable)
  ├── Members column (sortable)
  └── Admin column (sortable)
         ↓ drag between columns
    moveBlock() → Y.Map updated → sync

GeneratePanel → useAtelierScaffold → POST /api/atelier/scaffold-app
  → scaffoldApp() via jiti (CLI) → schemas → seed → config → install → generate → doctor
```

### Collaboration

Each project gets a Yjs room: `atelier:{teamId}:{projectId}` (structure: `map`).

Y.Map keys:
- `identity`: `{ name, description, icon }`
- `blocks`: `SelectedBlock[]` (blockId + visibility + order)

Project metadata (name, teamId) stored in DB. Composition state lives in Yjs only.

## Component Naming

All components auto-import with `Atelier` prefix:
- `BlockCard.vue` → `<AtelierBlockCard />`
- `BlockCanvas.vue` → `<AtelierBlockCanvas />`
- `GeneratePanel.vue` → `<AtelierGeneratePanel />`

## Common Tasks

### Add a new block
1. Add entry to `app/data/blocks.ts` with id, label, icon, package, visibility, collections
2. The block appears automatically in BlockPalette

### Add a new template
1. Add entry to `app/data/templates.ts` with block references
2. The template appears automatically in TemplateSelector

### Add a block from a new package
1. Add blocks to `app/data/blocks.ts` with the new package name
2. PackageList auto-detects the new package from selectedBlocks

### Modify the scaffold flow
1. `server/api/atelier/scaffold-app.post.ts` — server-side (same 7-step pattern as designer)
2. `app/composables/useAtelierScaffold.ts` — client-side (builds payload, calls endpoint)
3. `app/components/GeneratePanel.vue` — UI consuming the composable

### Phase B: Migrate blocks to manifests
1. Add `blocks?: ManifestBlock[]` to CroutonManifest type
2. Update `useBlockRegistry` to load from manifests instead of static data
3. Remove `app/data/blocks.ts`

## Dependencies

- **Extends**: `@fyit/crouton-collab` (which extends `@fyit/crouton`)
- **Peer**: `@fyit/crouton-core`, `@fyit/crouton-collab`, `@nuxt/ui ^4.0.0`, `nuxt ^4.0.0`
- **Runtime**: `@vueuse/nuxt`, `sortablejs` (from crouton-core)

## Testing

```bash
npx nuxt typecheck  # MANDATORY after any changes
```
