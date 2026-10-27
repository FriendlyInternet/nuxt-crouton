# CLAUDE.md - @fyit/crouton-collab

## Package Purpose

Real-time collaboration infrastructure for Nuxt Crouton using Yjs CRDTs. This package provides the foundation for collaborative features across all Crouton apps, enabling multiple users to edit the same content simultaneously with automatic conflict resolution.

**Why this package exists:**
- Generic collaboration layer usable by any Crouton package
- Separates collaboration infrastructure from domain-specific code
- `crouton-flow` and `crouton-pages` can extend this package
- Provides consistent presence/awareness across the platform

## Key Files

| File | Purpose |
|------|---------|
| `server/durable-objects/CollabRoom.ts` | Cloudflare Durable Object for Yjs sync |
| `server/routes/api/collab/[roomId]/ws.ts` | WebSocket endpoint (local dev via crossws) |
| `server/routes/api/collab/token.get.ts` | HMAC token endpoint for cross-origin WS auth |
| `server/database/migrations/0001_yjs_collab_states.sql` | D1 table for state persistence |
| `app/types/collab.ts` | TypeScript types for collaboration |
| `app/composables/useCollabConnection.ts` | Low-level WebSocket connection manager |
| `app/composables/useCollabSync.ts` | High-level Yjs structure sync |
| `app/composables/useCollabPresence.ts` | Cursor/selection presence tracking |
| `app/composables/useCollabEditor.ts` | TipTap editor integration |
| `app/composables/useCollectionSyncSignal.ts` | Real-time collection cache sync across clients |
| `app/plugins/collection-sync.client.ts` | Auto-hooks mutations for cross-client refresh |
| `app/components/CollabStatus.vue` | Connection status indicator (dot + label) |
| `app/components/CollabPresence.vue` | Stacked user avatars with overflow |
| `app/components/CollabCursors.vue` | Remote cursor overlay rendering |
| `app/components/CollabIndicator.vue` | Combined status + presence for toolbars |
| `app/composables/useCollabRoomUsers.ts` | Poll room users via HTTP (Phase 6) |
| `app/components/CollabEditingBadge.vue` | "X editing" badge for list items (Phase 6) |
| `server/utils/collabRoomStore.ts` | Shared in-memory room storage for local dev |
| `server/routes/api/collab/[roomId]/users.get.ts` | HTTP endpoint for room users |
| `wrangler.example.toml` | Cloudflare configuration template |

## Architecture

### Local Development

In local dev, everything runs in-process — the crossws handler at `/api/collab/[roomId]/ws` handles WebSocket connections directly.

```
Client → ws://localhost:3000/api/collab/{roomId}/ws → crossws handler (in-process)
```

### Production (Cloudflare Workers)

Two facts force a split architecture in production:

1. **Nitro cannot proxy WebSocket frames** — a Nitro middleware can forward the 101 upgrade, but no messages flow through, so the client must reach the Durable Object directly.
2. **The Durable Object ships as its own standalone Worker** — decoupled from the Nuxt app's deploy lifecycle; the app's Nitro `cloudflare_module` worker doesn't export DO classes, so `CollabRoom` lives in a dedicated Worker bound via `script_name`.

The client must connect **directly** to a standalone collab worker, bypassing Nitro entirely:

```
Client Browser
  │ wss://{collab-worker}/{roomKey}/ws?token=...
  │ (direct connection — bypasses Nitro)
  ▼
Collab Worker (standalone Cloudflare Worker)
  │ Routes by roomKey to DO instance
  ▼
CollabRoom Durable Object
  ├── WebSocket sync (Yjs CRDTs)
  ├── Awareness/presence
  ├── DO storage (fast) + D1 (durable)
  └── Auth: HMAC token verification

Nuxt app (Cloudflare Workers)
  └── /api/collab/token → HMAC-signed {userId, exp} using BETTER_AUTH_SECRET
```

### Cross-Origin Auth Flow

Since the collab worker is a different origin, session cookies aren't sent. `useCollabConnection` handles this automatically:

1. Detects `collabWorkerUrl` is set (cross-origin)
2. Fetches `/api/collab/token` from the app (same-origin, cookies sent)
3. Server validates session, creates HMAC-signed token
4. Client passes token as `?token=` query param to worker WebSocket
5. CollabRoom DO verifies HMAC signature and expiry

Both the app and collab worker must share `BETTER_AUTH_SECRET`.

### Runtime Config

The package provides `collabWorkerUrl` in `runtimeConfig.public`. Apps do NOT need to redeclare it — just set the env var in production:

```bash
NUXT_PUBLIC_COLLAB_WORKER_URL=https://my-collab-worker.workers.dev
```

## How CollabRoom Works

1. **Connection**: Client connects via WebSocket with `type` and `roomId` params
2. **Initial Sync**: CollabRoom sends full Y.Doc state to new client
3. **Updates**: Clients send Yjs binary updates, CollabRoom applies and broadcasts
4. **Awareness**: JSON messages track cursor positions, selections, presence
5. **Persistence**: Debounced (1s) save to both DO storage and D1

### Room Types

The `type` query parameter differentiates room types:

| Type | Use Case | Yjs Structure |
|------|----------|---------------|
| `page` | TipTap editor content | `Y.XmlFragment` |
| `flow` | Node graphs | `Y.Map` |
| `document` | Plain text | `Y.Text` |
| `sync` | Collection version sync | `Y.Map` |
| `generic` | Custom | Any |

### Known Constraints

- **Nitro cannot proxy WebSocket frames** — The 101 upgrade succeeds but no messages flow. Clients must connect directly to the collab worker in production.
- **CollabRoom ships as a dedicated Worker** — the DO lives in its own standalone Worker (decoupled deploy lifecycle; the app's Nitro worker doesn't export DO classes), referenced via `script_name`.
- **`NUXT_PUBLIC_COLLAB_WORKER_URL` is build-time** — It's baked into the client bundle. Changing it requires a rebuild.
- **Token expiry is 60 seconds** — Enough for initial connection. Reconnections auto-fetch a fresh token.
- **`BETTER_AUTH_SECRET` must match** — Both the Nuxt app and collab worker use the same secret for HMAC signing/verification.

## Real-Time Collection Sync

When `crouton-collab` is installed, collection lists automatically stay in sync across all clients. If User A creates/updates/deletes an item, User B's list refreshes automatically.

### How It Works

```
User A (mutates)                    User B (viewing list)
      |                                    |
      v                                    |
useCollectionMutation                      |
      |                                    |
      v                                    v
crouton:mutation hook              useCollectionSyncSignal()
      |                                    |
      v                                    v
signalChange(collection)           Y.Map.observe()
      |                                    |
      v                                    v
  Y.Map.set(collection, version++)  debounced refreshNuxtData()
      |                                    |
      v                                    v
CollabRoom (broadcast)  ---------->  Lists auto-update
```

### Automatic Setup

The plugin `collection-sync.client.ts` automatically:
1. Detects team context from route params
2. Connects to a team-scoped sync room: `team:{teamId}:sync`
3. Hooks into `crouton:mutation` to signal changes
4. Refreshes collection caches when remote changes are detected

**Zero configuration required** - just install the package.

### Manual Usage (Optional)

For custom scenarios, use `useCollectionSyncSignal` directly:

```typescript
const { signalChange, connected, versions } = useCollectionSyncSignal({
  teamId: computed(() => currentTeam.value?.id),
  debounceMs: 300,
  onCollectionChanged: async (collection, version) => {
    // Custom refresh logic
    await myRefreshFunction(collection)
  }
})

// After a custom mutation
signalChange('products')
```

### Key Design Decisions

1. **Generic, not domain-specific**: CollabRoom doesn't know about "nodes" or "pages"
2. **Consumer syncs to collections**: This package only stores Yjs blob state
3. **Phase 6 ready**: `/users` endpoint returns current users for global presence

## Usage

### 1. Extend in nuxt.config.ts

```typescript
export default defineNuxtConfig({
  extends: ['@fyit/crouton-collab']
})
```

### 2. Deploy a Collab Worker

**One setting (#2693):** with `extends: ['@fyit/crouton-collab']` in the app, set `"collab": true` in
`apps/<app>/deploy.config.json`. The reusable `deploy-app.yml` then deploys the Worker from
`worker-template` (`<app>-collab-staging` / `<app>-collab`, `<app>-pr<N>-collab` for previews) with
auto-provisioned D1, shares the app's `BETTER_AUTH_SECRET`, applies the migration, and builds the app
with `NUXT_PUBLIC_COLLAB_WORKER_URL` — in that order. Steps 2–5 below are the manual fallback only.


The collab Durable Object ships as a standalone Worker:

```
workers/collab-worker/
├── src/index.ts          # Routes /{roomKey}/{action} to CollabRoom DO
├── wrangler.toml         # DO bindings, D1 binding, BETTER_AUTH_SECRET
└── package.json
```

The worker's `wrangler.toml`:
```toml
name = "my-app-collab"

[[durable_objects.bindings]]
name = "COLLAB_ROOMS"
class_name = "CollabRoom"

[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id = "..."

[[migrations]]
tag = "collab-v1"
new_classes = ["CollabRoom"]
```

Deploy the worker and set the shared secret:
```bash
cd workers/collab-worker
npx wrangler secret put BETTER_AUTH_SECRET  # Same value as your Nuxt app
npx wrangler deploy
```

The app references the worker via `script_name` in its `wrangler.toml` (for DO binding):
```toml
[[durable_objects.bindings]]
name = "COLLAB_ROOMS"
class_name = "CollabRoom"
script_name = "my-app-collab"
```

### 3. Set the Worker URL

Set at **build time** (baked into client bundle via runtimeConfig.public):
```bash
NUXT_PUBLIC_COLLAB_WORKER_URL=https://my-app-collab.workers.dev
```

### 4. Run D1 Migration

```bash
npx wrangler d1 execute <DB_NAME> --remote \
  --file=./packages/nuxt-crouton-collab/server/database/migrations/0001_yjs_collab_states.sql
```

### 5. Deploy Order

1. Deploy collab worker first (the Nuxt app references it via `script_name`)
2. Run D1 migration (first time only)
3. Deploy the Nuxt app with `NUXT_PUBLIC_COLLAB_WORKER_URL` set

### 4. Connect from Client

```typescript
// For flows/graphs (Y.Map structure)
const { ymap, data, connected, synced, users } = useCollabSync({
  roomId: 'flow-123',
  roomType: 'flow',
  structure: 'map'
})

// For rich text editors (Y.XmlFragment structure)
const { yxmlFragment, connected } = useCollabSync({
  roomId: 'page-123',
  roomType: 'page',
  structure: 'xmlFragment'
})

// For TipTap with full presence support
const { ydoc, yxmlFragment, provider, users } = useCollabEditor({
  roomId: 'page-123',
  user: { name: 'Alice' }
})
```

## Composables Reference

### useCollabConnection (Low-Level)

Manages WebSocket connections with exponential backoff reconnection.

```typescript
const {
  connected,    // ComputedRef<boolean>
  synced,       // ComputedRef<boolean>
  error,        // ComputedRef<Error | null>
  ws,           // Ref<WebSocket | null>
  ydoc,         // Y.Doc
  connect,      // () => void
  disconnect,   // () => void
  send,         // (data) => void
  sendAwareness // (state) => void
} = useCollabConnection({
  roomId: 'room-123',
  roomType: 'page',
  autoConnect: true  // default
})
```

### useCollabSync (High-Level)

Wraps connection and provides typed access to Yjs structures.

```typescript
const {
  // Connection state
  connected, synced, error,

  // Yjs structures (one populated based on structure option)
  ymap,           // Y.Map | null
  yarray,         // Y.Array | null
  yxmlFragment,   // Y.XmlFragment | null
  ytext,          // Y.Text | null

  // Reactive data (auto-updated for Y.Map)
  data,           // Ref<Record<string, unknown>>
  arrayData,      // Ref<unknown[]>

  // Users in room
  users,          // Ref<CollabAwarenessState[]>

  // Actions
  connect, disconnect
} = useCollabSync({
  roomId: 'room-123',
  roomType: 'flow',
  structure: 'map',       // 'map' | 'array' | 'xmlFragment' | 'text'
  structureName: 'nodes'  // optional, defaults to roomType
})
```

### useCollabPresence

Tracks cursor positions, selections, and presence for all users.

```typescript
const {
  user,           // ComputedRef<CollabUser | null>
  users,          // Ref<CollabAwarenessState[]>
  otherUsers,     // ComputedRef<CollabAwarenessState[]>

  // Actions
  updateCursor,   // (cursor) => void
  updateSelection,// (selection) => void
  selectNode,     // (nodeId) => void
  updateGhostNode,// (ghostNode) => void

  // Utilities
  getUsersSelectingNode,  // (nodeId) => CollabAwarenessState[]
  getUserColor,           // (userId) => string
  getNodePresenceStyle    // (nodeId) => { boxShadow?, borderColor? }
} = useCollabPresence({
  connection,     // from useCollabConnection
  user: { name: 'Alice' }  // optional, auto-detected from session
})
```

### useCollabEditor (TipTap Integration)

Ready-to-use setup for collaborative rich text editing with TipTap.

```typescript
const {
  // Connection state
  connected, synced, error,

  // Yjs for TipTap
  ydoc,           // Y.Doc
  yxmlFragment,   // Y.XmlFragment

  // Presence
  user, users, otherUsers,

  // For TipTap Collaboration extension
  provider,       // { awareness: { setLocalStateField, ... } }

  // Actions
  connect, disconnect,
  updateCursor, updateSelection
} = useCollabEditor({
  roomId: 'page-123',
  roomType: 'page',    // default
  field: 'content',    // default
  user: { name: 'Alice', color: '#ff0000' }
})

// Use with TipTap
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor'

const editor = useEditor({
  extensions: [
    Collaboration.configure({
      document: ydoc,
      field: 'content'
    }),
    CollaborationCursor.configure({
      provider,
      user: { name: 'Alice', color: '#ff0000' }
    })
  ]
})
```

## UI Components Reference

### CollabStatus

Connection status indicator with colored dot and optional label.

```vue
<CollabStatus
  :connected="connection.connected"
  :synced="connection.synced"
  :error="connection.error"
  :show-label="true"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `connected` | `boolean` | required | WebSocket connected |
| `synced` | `boolean` | required | Initial sync complete |
| `error` | `Error \| null` | `null` | Connection error |
| `showLabel` | `boolean` | `true` | Show text label |

Status colors:
- Green: synced and ready
- Yellow (pulsing): connecting or syncing
- Red: error
- Gray: disconnected

### CollabPresence

Stacked user avatars with overflow indicator.

```vue
<CollabPresence
  :users="presence.otherUsers"
  :max-visible="5"
  size="sm"
  :show-tooltip="true"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `users` | `CollabAwarenessState[]` | required | Users to display |
| `maxVisible` | `number` | `5` | Max avatars before +N |
| `size` | `'xs' \| 'sm' \| 'md'` | `'sm'` | Avatar size |
| `showTooltip` | `boolean` | `true` | Show name on hover |

### CollabCursors

Remote cursor overlay for canvas/editor content.

```vue
<div class="relative">
  <CollabCursors
    :users="presence.otherUsers"
    :show-labels="true"
  />
  <!-- Your content here -->
</div>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `users` | `CollabAwarenessState[]` | required | Users with cursors |
| `showLabels` | `boolean` | `true` | Show name labels |
| `offsetX` | `number` | `0` | X position offset |
| `offsetY` | `number` | `0` | Y position offset |

### CollabIndicator

Combined status + presence for toolbars/headers.

```vue
<CollabIndicator
  :connected="connection.connected"
  :synced="connection.synced"
  :error="connection.error"
  :users="presence.otherUsers"
  :max-visible-users="3"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `connected` | `boolean` | required | WebSocket connected |
| `synced` | `boolean` | required | Initial sync complete |
| `error` | `Error \| null` | `null` | Connection error |
| `users` | `CollabAwarenessState[]` | required | Users to display |
| `maxVisibleUsers` | `number` | `3` | Max avatars to show |

### useCollabRoomUsers (Phase 6 - Global Presence)

Polls room users via HTTP for displaying presence in collection lists.

```typescript
const {
  // Users
  users,          // Ref<CollabAwarenessState[]> - All users
  otherUsers,     // ComputedRef<CollabAwarenessState[]> - Excluding current user
  count,          // ComputedRef<number> - Total count
  otherCount,     // ComputedRef<number> - Other users count

  // State
  loading,        // Ref<boolean>
  error,          // Ref<Error | null>
  isPolling,      // ComputedRef<boolean>

  // Actions
  refresh,        // () => Promise<void>
  startPolling,   // () => void
  stopPolling     // () => void
} = useCollabRoomUsers({
  roomId: 'page-123',           // Can be string or Ref
  roomType: 'page',             // default
  pollInterval: 5000,           // default: 5 seconds
  currentUserId: user.value?.id,// Exclude self from count
  excludeSelf: true,            // default
  immediate: true               // default: start polling on mount
})
```

### CollabEditingBadge (Phase 6 Component)

Shows "X editing" badge on collection list items.

```vue
<CollabEditingBadge
  room-id="page-123"
  room-type="page"
  :current-user-id="currentUser?.id"
  :poll-interval="5000"
  size="xs"
  :show-avatars="true"
  :max-avatars="5"
/>
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `roomId` | `string` | required | Room ID to check |
| `roomType` | `string` | `'page'` | Room type |
| `currentUserId` | `string` | - | Exclude self from count |
| `pollInterval` | `number` | `5000` | Poll interval in ms |
| `size` | `'xs' \| 'sm' \| 'md'` | `'xs'` | Badge size |
| `showAvatars` | `boolean` | `true` | Show user avatars on hover |
| `maxAvatars` | `number` | `5` | Max avatars in tooltip |

## WebSocket Protocol

### Binary Messages (Yjs Updates)

Raw Uint8Array containing Yjs update data.

### JSON Messages

```typescript
// Awareness update
{
  type: 'awareness',
  userId: 'user-123',
  state: {
    user: { id: 'user-123', name: 'Alice', color: '#ff0000' },
    cursor: { x: 100, y: 200 },
    selection: { anchor: 10, head: 20 }
  }
}

// Ping/Pong for connection health
{ type: 'ping' }
{ type: 'pong' }

// Awareness broadcast (from server)
{
  type: 'awareness',
  users: [/* all connected users' states */]
}
```

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/collab/[roomId]/ws?type=X` | GET | WebSocket upgrade |
| `/api/collab/[roomId]/users?type=X` | GET | Get current users (Phase 6) |
| `/state` (via DO) | GET | Get current Yjs state as binary |
| `/users` (via DO) | GET | Get current users JSON |

### Users Endpoint Response

```json
{
  "users": [
    {
      "user": { "id": "user-123", "name": "Alice", "color": "#ff0000" },
      "cursor": { "x": 100, "y": 200 }
    }
  ],
  "count": 1
}
```

## Types Reference

```typescript
interface CollabUser {
  id: string
  name: string
  color: string
}

interface CollabAwarenessState {
  user: CollabUser
  cursor: { x: number; y: number } | null
  selection?: { anchor: number; head: number } | null
  selectedNodeId?: string | null
  ghostNode?: { id: string; position: { x: number; y: number } } | null
  [key: string]: unknown  // Extensible
}

interface CollabConnectionState {
  connected: boolean
  synced: boolean
  error: Error | null
}

type CollabStructure = 'map' | 'array' | 'xmlFragment' | 'text'
```

## Dependencies

- **Extends**: `@fyit/crouton-core`
- **Runtime**: `yjs`, `y-protocols`
- **Dev**: `@cloudflare/workers-types`

## Phase Roadmap

This package is part of a 7-phase collaboration implementation:

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Complete | Package foundation (CollabRoom DO, D1 table, types) |
| 2 | ✅ Complete | Core composables (useCollabConnection, useCollabSync, useCollabPresence, useCollabEditor) |
| 3 | ✅ Complete | UI components (CollabStatus, CollabPresence, CollabCursors, CollabIndicator) |
| 4 | ✅ Complete | Refactor crouton-flow to use this package |
| 5 | ✅ Complete | Add collaborative editing to crouton-pages |
| 6 | ✅ Complete | Global presence ("2 people editing" in lists) |
| 7 | ✅ Complete | Testing and documentation |

## Testing

```bash
# MANDATORY after any changes
cd packages/nuxt-crouton-collab
npx nuxt typecheck

# Alternative: Verify specific files compile
npx tsc --noEmit --skipLibCheck \
  app/types/collab.ts \
  app/composables/useCollabConnection.ts \
  app/composables/useCollabSync.ts \
  app/composables/useCollabPresence.ts \
  app/composables/useCollabEditor.ts \
  app/composables/useCollabRoomUsers.ts
```

## CroutonCollection Integration

When both `nuxt-crouton` and `nuxt-crouton-collab` are installed, you can enable
global presence badges in collection lists:

```vue
<CroutonCollection
  collection="pages"
  :rows="pages"
  :show-collab-presence="true"
/>

<!-- With custom configuration -->
<CroutonCollection
  collection="pages"
  :rows="pages"
  :show-collab-presence="{
    roomType: 'page',
    currentUserId: currentUser?.id,
    pollInterval: 10000,
    getRoomId: (row, collection) => `${collection}-${row.id}`
  }"
/>
```

The badges appear automatically on list, grid, and cards layouts when users
are actively editing those items.

## Common Tasks

### Add a new room type

1. No changes needed to this package
2. Consumer creates composable using `useCollabSync` with new type
3. Consumer handles domain-specific syncing to collection tables

### Debug connection issues

1. Check browser WebSocket tab in DevTools
2. Verify `type` and `roomId` query params
3. Check Cloudflare Durable Object logs
4. Verify D1 migration was run

### Check who's in a room

```bash
# Via curl (when DO is running)
curl https://your-app.com/api/collab/room-123/users
```
