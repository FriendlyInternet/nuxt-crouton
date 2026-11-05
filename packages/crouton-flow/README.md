# nuxt-crouton-flow

Vue Flow integration layer for Nuxt Crouton - graph/DAG visualization with real-time multiplayer collaboration.

## Features

- **Graph Visualization**: Render collection data as interactive node graphs
- **Automatic Layout**: Dagre-based tree/DAG layout for hierarchical data
- **Real-time Sync**: Multiplayer collaboration via Yjs CRDTs
- **Presence Awareness**: See other users' cursors and selections
- **Position Persistence**: Drag-and-drop with automatic position saving
- **Custom Nodes**: Use collection-specific node components

## Installation

```bash
pnpm add @fyit/crouton-flow
```

Add to your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-flow'
  ]
})
```

## Basic Usage

```vue
<template>
  <CroutonFlow
    :rows="decisions"
    collection="decisions"
    parent-field="parentId"
    position-field="position"
  />
</template>

<script setup lang="ts">
const { data: decisions } = await useCollectionQuery('decisions')
</script>
```

## Real-time Multiplayer Sync

Enable multiplayer collaboration with the `sync` prop:

```vue
<template>
  <CroutonFlow
    collection="decisions"
    sync
    :flow-id="projectId"
  />
</template>

<script setup lang="ts">
const route = useRoute()
const projectId = route.params.projectId as string
</script>
```

### How It Works

When `sync` is enabled:

1. **Yjs CRDT**: All node state is managed by a Yjs document
2. **Durable Objects**: A Cloudflare Durable Object handles WebSocket connections
3. **Real-time Sync**: Changes are broadcast to all connected clients
4. **Dual Persistence**: State is saved both as Yjs blob and individual rows

### Prerequisites

1. **D1 Database**: Run the migration to create the `yjs_flow_states` table:

```sql
-- server/database/migrations/0001_yjs_flow_states.sql
CREATE TABLE IF NOT EXISTS yjs_flow_states (
  flow_id TEXT PRIMARY KEY,
  collection_name TEXT NOT NULL,
  state BLOB NOT NULL,
  version INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
```

2. **Wrangler Config**: Configure Durable Objects in `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "FLOW_ROOMS"
class_name = "FlowRoom"

[[migrations]]
tag = "v1"
new_classes = ["FlowRoom"]
```

3. **Authentication**: Users must be authenticated via `useSession()` for presence features.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `rows` | `Record<string, unknown>[]` | - | Collection rows (not needed with sync) |
| `collection` | `string` | **required** | Collection name |
| `parentField` | `string` | `'parentId'` | Field for parent relationships |
| `positionField` | `string` | `'position'` | Field for node positions |
| `labelField` | `string` | `'title'` | Field for node labels |
| `sync` | `boolean` | `false` | Enable real-time sync |
| `flowId` | `string` | - | Flow ID (required with sync) |
| `controls` | `boolean` | `true` | Show zoom controls |
| `minimap` | `boolean` | `false` | Show minimap |
| `background` | `boolean` | `true` | Show background pattern |
| `draggable` | `boolean` | `true` | Enable node dragging |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `nodeClick` | `(nodeId, data)` | Node clicked |
| `nodeDblClick` | `(nodeId, data)` | Node double-clicked |
| `nodeMove` | `(nodeId, position)` | Node position changed |
| `edgeClick` | `(edgeId)` | Edge clicked |

## Custom Node Components

Create a `[Collection]Node.vue` component to customize node rendering:

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
  <div class="custom-node" :class="{ selected, dragging }">
    <h3>{{ data.title }}</h3>
    <p>{{ data.status }}</p>
  </div>
</template>
```

## Composables

### useFlowSync

Direct access to the sync state for advanced use cases:

```typescript
const {
  nodes,           // Readonly ref of all nodes
  connected,       // WebSocket connected
  synced,          // Initial sync complete
  error,           // Connection error
  users,           // Online users
  createNode,      // Create a new node
  updateNode,      // Update node data
  updatePosition,  // Update node position
  deleteNode,      // Delete a node
  selectNode,      // Broadcast node selection
  updateCursor,    // Broadcast cursor position
} = useFlowSync({
  flowId: 'my-flow',
  collection: 'decisions'
})
```

### useFlowPresence

Utilities for presence UI:

```typescript
const { otherUsers, getUsersSelectingNode, getNodePresenceStyle } = useFlowPresence({
  users: computed(() => syncState.users),
  currentUserId: currentUser.id
})
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Client A │  │ Client B │  │ Client C │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │             │             │                         │
│       └─────────────┼─────────────┘                         │
│                     │ WebSocket                             │
│                     ▼                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Cloudflare Durable Object                 │   │
│  │                 (FlowRoom)                          │   │
│  │  - Manages Yjs Y.Doc per flow                       │   │
│  │  - Handles WebSocket connections                    │   │
│  │  - Merges updates from all clients                  │   │
│  │  - Persists to D1 on changes                        │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 D1 (SQLite)                         │   │
│  │  yjs_flow_states    │  collection tables            │   │
│  │  (fast reload)      │  (queryable records)          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## License

MIT
