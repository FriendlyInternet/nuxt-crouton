# CLAUDE.md - @fyit/crouton-flow

## Package Purpose

Vue Flow integration for Nuxt Crouton. Renders collection data as interactive node graphs with automatic DAG layout, real-time multiplayer sync via Yjs CRDTs, and presence awareness.

**Uses crouton-collab for collaboration infrastructure** (as of Phase 4). Connection management, Yjs sync, and presence tracking are now provided by the shared collab package.

## Key Files

| File | Purpose |
|------|---------|
| `app/components/Flow.vue` | Main graph component (orchestrates composables). `defaultNodeComponent` prop injects a node card on the default render path (wrappers in this prefixed package can't use the by-collection-name `{Collection}Node` lookup — the `CroutonFlow` prefix makes it unreachable). |
| `app/components/SiteFlow.vue` | `CroutonFlowSiteFlow` — the **Site level** of the Crouton Builder (WS3 #872, epic #868). A thin preset over `CroutonFlow` that renders the existing `pages` collection as a wireable sitemap (cards = pages, lines = `parentId`, positions → `flow_configs`, `sync` → Yjs multiplayer — all reused, not new). Injects `PageNode` via `defaultNodeComponent`, `provide`s `croutonSiteFlowZoom`, and emits `zoomIntoPage` (the original page row) so the zoom shell's `#site` slot descends into that page's layout. NOT a new data model — just another *view* of the pages you already have. |
| `app/components/PageNode.vue` | `CroutonFlowPageNode` — the page-card node type (icon + label + slug + ⤡ zoom affordance, source/target handles). Injects `croutonSiteFlowZoom`; ⤡ or double-click descends the zoom shell into the page. |
| `app/composables/useFlowDragDrop.ts` | External drag-and-drop onto canvas |
| `app/composables/useFlowSyncBridge.ts` | Yjs ↔ Vue Flow data bridge |
| `app/composables/useFlowSync.ts` | Flow sync (wraps useCollabSync) |
| `app/composables/useFlowPresence.ts` | Presence UI utilities |
| `app/composables/useFlowEphemeralData.ts` | Convert non-collection items to Vue Flow nodes |
| `app/composables/useFlowContainerDetection.ts` | Card-over-group overlap detection on drag stop |
| `app/composables/useFlowPositionStore.ts` | Save positions to flow_configs via REST (no collection schema needed) |
| `app/composables/useFlowPositionSync.ts` | Position-only Yjs sync for ephemeral mode (real-time multiplayer) |
| `app/composables/useFlowGroupManager.ts` | Group CRUD, assignments, auto-grouping |
| `app/types/yjs.ts` | Flow node types (uses collab types) |
| `app/types/flow.ts` | Flow config, data mode, container options types |
| `app/app.config.ts` | App registration (croutonApps) |
| `server/database/schema.ts` | Drizzle schema for flow_configs table |
| `server/database/migrations/0002_flow_configs.sql` | SQL migration for flow_configs |
| `server/database/migrations/0003_flow_node_positions.sql` | Add node_positions column |
| `server/api/crouton-flow/teams/[id]/flows/` | CRUD API for flow configs |
| `app/pages/admin/[team]/flows.vue` | Flows workspace — split-panel layout using CroutonWorkspaceLayout (sidebar list + canvas) |
| `app/components/Workspace/Sidebar.vue` | `CroutonFlowWorkspaceSidebar` — searchable flow list with badges and context menus |
| `server/durable-objects/FlowRoom.ts` | **DEPRECATED** - Use CollabRoom |
| `server/routes/api/flow/[flowId]/ws.ts` | **DEPRECATED** - Use collab endpoint |

## Admin App

crouton-flow registers itself as a crouton app with an admin section at `/admin/[team]/flows`.

### flow_configs Table

Stores saved flow configurations per team:

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| team_id | TEXT | Team this flow belongs to |
| name | TEXT | Display name |
| description | TEXT | Optional description |
| collection | TEXT | Collection name to visualize |
| label_field | TEXT | Field to use as node label (default: 'title') |
| parent_field | TEXT | Field for parent relationship (default: 'parentId') |
| position_field | TEXT | Field for node position (default: 'position') |
| sync_enabled | INTEGER | Enable live multiplayer sync |
| node_positions | TEXT (JSON) | Saved node positions `{ [nodeId]: { x, y } }` — decoupled from collection schema |

### API Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/api/crouton-flow/teams/[id]/flows` | GET | List team flows |
| `/api/crouton-flow/teams/[id]/flows` | POST | Create flow |
| `/api/crouton-flow/teams/[id]/flows/[flowId]` | GET | Get single flow |
| `/api/crouton-flow/teams/[id]/flows/[flowId]` | PATCH | Update flow |
| `/api/crouton-flow/teams/[id]/flows/[flowId]` | DELETE | Delete flow |
| `/api/crouton-flow/teams/[id]/flows/[flowId]/positions` | PATCH | Save node positions (debounced from client) |

### Setup (consuming app)

NuxtHub auto-discovers the `flow_configs` table via the package's `server/db/schema.ts`
(which re-exports `flowConfigs`). No manual schema import needed in the app's schema file.

Run the DB migration:
```bash
# Generate migration (NuxtHub picks up flow_configs automatically)
npx nuxt db generate
# Apply locally
npx wrangler d1 execute <DB_NAME> --local \
  --file=server/db/migrations/sqlite/<generated_migration>.sql
```

The `server/db/schema.ts` file in this package is what NuxtHub scans to include
`flow_configs` in migrations. It re-exports from `server/database/schema.ts`.

## Yjs node shape: `data` vs `ephemeral`

`YjsFlowNode` has two distinct namespaces for fields, and they must not be confused:

| Field | Owner | Lifecycle | Used for |
|-------|-------|-----------|----------|
| `node.data` | DB row mirror | Overwritten by `useFlowSyncBridge` on every row refetch | Whatever columns the consuming app's collection schema defines (status, brief, template, artifacts, etc.) |
| `node.ephemeral` | Yjs collaborators | Never touched by the bridge — survives row refetches | Live agent activity from workers, transient control signals, anything Yjs-only |

**Why the split exists:** the bridge's row-sync watcher does `data: { ...row }`, which silently wipes anything a collaborator wrote into the same bag. Before this split, Pi worker writes to `agentLog`/`agentStatus` would disappear whenever the DB row refetched. Now they live on `node.ephemeral` and survive.

**Writing to ephemeral:** use `useFlowSync().updateEphemeral(nodeId, patch)` from the browser, or the equivalent `updateEphemeral` method on the Pi worker's `YjsFlowClient`. Never write Yjs-only state into `node.data` — the next row refetch will clobber it.

**Reading from ephemeral in custom node components:** Vue Flow only forwards `data`, `selected`, `dragging`, `label` to custom node components. So at the Vue Flow boundary, the bridge surfaces `node.ephemeral` as `data.ephemeral` (namespaced inside the data prop):

```vue
<script setup lang="ts">
defineProps<{
  data: Record<string, unknown>
  selected: boolean
}>()

// Read live agent state written by a worker collaborator
const ephemeral = computed(() => (props.data as any).ephemeral || {})
const agentStatus = computed(() => ephemeral.value.agentStatus)
</script>
```

The boundary stays honest at the Yjs layer (`node.ephemeral` is a true sibling of `node.data`); the namespacing inside the Vue Flow data prop is purely a forwarding-mechanism workaround.

## Dependencies

- **Extends**: `@fyit/crouton-collab` (for collaboration infrastructure)
- **Peer Dependencies**: `@fyit/crouton`
- **Core**: `@vue-flow/core`, `@dagrejs/dagre`, `yjs`
- **Plugins**: `@vue-flow/background`, `@vue-flow/controls`, `@vue-flow/minimap`

## Basic Usage

```vue
<CroutonFlow
  :rows="decisions"
  collection="decisions"
  parent-field="parentId"
  position-field="position"
/>
```

## Real-time Multiplayer

```vue
<CroutonFlow
  collection="decisions"
  sync
  :flow-id="projectId"
/>
```

When `sync` is enabled:
1. Uses crouton-collab's CollabRoom Durable Object
2. Connects to `/api/collab/[flowId]/ws?type=flow`
3. Yjs CRDT manages all node state with conflict resolution
4. Changes broadcast to all connected clients in real-time
5. Dual persistence: Yjs blob + individual rows

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rows` | `array` | - | Collection rows (not needed with sync). Supports `v-model:rows` in ephemeral mode for position sync. |
| `collection` | `string` | **required** | Collection name |
| `parentField` | `string` | `'parentId'` | Parent relationship field |
| `positionField` | `string` | `'position'` | Node position field |
| `labelField` | `string` | `'title'` | Node label field |
| `sync` | `boolean` | `false` | Enable real-time sync |
| `flowId` | `string` | - | Flow config ID. Required with sync. Also used without sync to persist positions to flow_configs. |
| `savedPositions` | `Record<string, { x, y }>` | - | Pre-loaded node positions from flow_configs (avoids extra fetch) |
| `controls` | `boolean` | `true` | Show zoom controls |
| `minimap` | `boolean` | `false` | Show minimap |
| `draggable` | `boolean` | `true` | Enable node dragging |
| `nodeTypeComponents` | `Record<string, NodeTypeRegistration>` | - | Custom node type components (key = type, value = { component, isContainer? }) |
| `containerOptions` | `{ enabled: boolean }` | - | Enable container detection on drag stop |
| `dataMode` | `'collection' \| 'ephemeral'` | `'collection'` | Data mode — 'ephemeral' skips collection mutations |
| `selected` | `string[]` | - | Selected node IDs (enables `v-model:selected`) |
| `additionalEdges` | `Array<{ id, source, target }>` | `[]` | Extra edges rendered alongside parent-derived edges (e.g. multi-parent synthesis connections) |
| `defaultNodeComponent` | `Component` | - | Explicit node component for the default render path (overrides `{Collection}Node` name resolution). Used by `CroutonFlowSiteFlow` to inject its page card. Ghost nodes still render as ghosts. |
| `focusBounds` | `{ x, y, width, height } \| null` | - | Camera focus — set a rect (flow coords) to zoom onto that area, clear it to fit the whole board. Deterministic (no re-measure): maps the rect's WIDTH to a constant fraction (~0.86) of the canvas width via `setCenter`, so scrubbing the rect to a wider device zooms OUT and the content stays ~the same on-screen size (responsive-preview feel). View transform only. Exposes `fitView` / `fitBounds` / `setCenter` via template ref. |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `nodeClick` | `(nodeId, data)` | Node clicked |
| `nodeDblClick` | `(nodeId, data)` | Node double-clicked |
| `nodeMove` | `(nodeId, position)` | Node moved (after drag) |
| `nodeDrag` | `(nodeId, position)` | Emitted continuously *while* dragging (live position, throttled ~50ms). Not gated on `sync` — use for live snap guides / alignment previews. |
| `edgeClick` | `(edgeId)` | Edge clicked |
| `nodeContainerChange` | `(ContainerChangeEvent)` | Node moved into/out of a container group |
| `connectEnd` | `({ sourceNodeId, sourceHandleType, position, mouseEvent })` | Connection drag ended in empty space (no target handle). Use to show a "create node" menu. |
| `update:rows` | `(rows)` | Emitted in ephemeral mode when node positions change (enables `v-model:rows`) |
| `update:selected` | `(selectedNodeIds: string[])` | Emitted when selection changes (enables `v-model:selected`). Primary API for tracking multi-select. |

## Composables

### useFlowSync (Wraps useCollabSync)

```typescript
// Provides flow-specific operations on top of collab sync
const {
  nodes, connected, synced, error, users,
  createNode, updateNode, updatePosition, updateContainer, updateDimensions, deleteNode,
  selectNode, updateCursor,
  updateGhostNode, clearGhostNode
} = useFlowSync({ flowId: 'my-flow', collection: 'decisions' })
```

### useFlowPositionSync (Position-only Yjs sync)

Lightweight Yjs sync for ephemeral mode — syncs only node positions, not full node data. Enables real-time multiplayer position sync for flows where data comes from external sources (e.g. Notion).

```typescript
const { positions, debouncedUpdate, connected, synced, users } =
  useFlowPositionSync({ flowId: 'flow-123' })
```

Activated automatically when `sync + dataMode="ephemeral" + flowId` are set on CroutonFlow.

### useFlowPresence (Uses collab types)

```typescript
// Presence UI utilities for flow graphs
const { otherUsers, getUsersSelectingNode, getNodePresenceStyle, getUserColor } = useFlowPresence({
  users: computed(() => syncState.users),
  currentUserId: currentUser.id
})
```

### useFlowEphemeralData

Converts non-collection items (e.g. Notion pages) to Vue Flow nodes via resolver functions:

```typescript
const { nodes, edges, getNode, getItem } = useFlowEphemeralData(items, {
  resolveNodeType: (item) => 'notionCard',
  resolveLabel: (item) => item.title as string,
  resolveContainerId: (item) => item.groupId as string | null,
  resolvePosition: (item) => item.position as { x: number, y: number },
})
```

### useFlowContainerDetection

Detects card-over-group overlap on drag stop:

```typescript
const { handleDragStop, detectContainer } = useFlowContainerDetection({
  nodeTypeComponents: { resizableGroup: { component: GroupNode, isContainer: true } },
})
```

### useFlowGroupManager

Group CRUD, assignments, and auto-grouping:

```typescript
const { groups, createGroup, removeGroup, renameGroup, getAssignments, autoGroupByProperty } = useFlowGroupManager({
  groupNodeType: 'resizableGroup',
})
```

## UI Components

Flow.vue uses these components from crouton-collab:

| Component | Purpose | Props |
|-----------|---------|-------|
| `CollabStatus` | Connection status dot | `connected`, `synced`, `error` |
| `CollabPresence` | User avatars | `users`, `maxVisible`, `size` |
| `CollabCursors` | Remote cursor overlay | `users`, `showLabels` |

## Custom Node Components

Create `[Collection]Node.vue` for custom rendering:

```vue
<!-- app/components/DecisionsNode.vue -->
<script setup lang="ts">
defineProps<{
  data: Record<string, unknown>
  selected: boolean
  dragging: boolean
  label?: string
}>()
</script>

<template>
  <div class="custom-node" :class="{ selected }">
    <h3>{{ data.title }}</h3>
  </div>
</template>
```

## Sync Prerequisites

### 1. Extend crouton-collab in your app

The flow package already extends crouton-collab, so you get this automatically when extending flow:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton',
    '@fyit/crouton-flow'  // Already extends crouton-collab
  ]
})
```

### 2. Configure Cloudflare Durable Objects

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "COLLAB_ROOMS"
class_name = "CollabRoom"

[[migrations]]
tag = "collab-v1"
new_classes = ["CollabRoom"]
```

### 3. Run D1 Migration

```bash
npx wrangler d1 execute <DB_NAME> \
  --file=./node_modules/@fyit/crouton-collab/server/database/migrations/0001_yjs_collab_states.sql
```

### 4. Authentication

Users are auto-detected via `useSession()` from crouton-auth.

## Architecture

```
Clients → WebSocket → /api/collab/[flowId]/ws?type=flow
                              ↓
                    CollabRoom Durable Object
                              ↓
                    Yjs Y.Doc (Y.Map for nodes)
                              ↓
                    D1 (yjs_collab_states + collection tables)
```

**Note:** The old `/api/flow/[flowId]/ws` endpoint and `FlowRoom` Durable Object are deprecated but kept for backward compatibility.

## Migration from Standalone FlowRoom

If you were using the old flow-specific infrastructure:

1. **No code changes needed** - useFlowSync now wraps useCollabSync internally
2. **Update Cloudflare config** - Replace FlowRoom with CollabRoom
3. **Data migration** - Move data from `yjs_flow_states` to `yjs_collab_states` with `room_type='flow'`

## Component Naming

Components auto-import with `CroutonFlow` prefix:
- `Flow.vue` → `<CroutonFlow />`

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
