# CLAUDE.md - @fyit/crouton-events

## Package Purpose

Automatic event tracking and audit trail for Nuxt Crouton collections. Hooks into `crouton:mutation` events to log all CREATE, UPDATE, DELETE operations with smart diff and user attribution.

## Key Files

| File | Purpose |
|------|---------|
| `app/composables/useCroutonEvents.ts` | Query enriched events with user data |
| `app/composables/useCroutonEventsExport.ts` | Export events as CSV/JSON |
| `app/components/CroutonActivityLog.vue` | Main activity log page with stats |
| `app/components/CroutonActivityTimeline.vue` | Timeline visualization with date groups |
| `app/components/CroutonActivityTimelineItem.vue` | Individual event row |
| `app/components/CroutonActivityFilters.vue` | Filter controls (collection, operation, date) |
| `app/components/CroutonEventDetail.vue` | Event detail modal |
| `app/components/CroutonEventChangesTable.vue` | Before/after diff table |
| `server/database/schema.ts` | Internal Drizzle schema for crouton_events table |
| `server/database/migrations/` | SQL migrations bundled with the package |
| `server/api/teams/[teamId]/crouton-collection-events/index.post.ts` | Write endpoint (called by tracker) |
| `server/api/teams/[teamId]/crouton-events/index.get.ts` | Query endpoint (called by useCroutonEvents) |
| `server/api/teams/[teamId]/crouton-events/export.get.ts` | Export API endpoint |
| `events-schema.json` | Event collection schema |

## How It Works

```
User Action → nuxt-crouton mutation → crouton:mutation hook
                                            ↓
                                    Event Listener Plugin
                                            ↓
                                    Smart Diff (old → new)
                                            ↓
                                    Async Tracking (non-blocking)
                                            ↓
                                    crouton_events table
```

## Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-events'
  ],
  runtimeConfig: {
    public: {
      croutonEvents: {
        enabled: true,
        snapshotUserName: true,
        errorHandling: {
          mode: 'toast',        // 'silent' | 'toast' | 'throw'
          logToConsole: true
        },
        retention: {
          enabled: true,
          days: 90,
          maxEvents: 100000
        }
      }
    }
  }
})
```

## Event Schema

```typescript
interface CroutonEvent {
  id: string
  timestamp: Date
  operation: 'create' | 'update' | 'delete'
  collectionName: string
  itemId: string
  teamId: string
  userId: string
  userName: string              // Snapshot at time of event
  changes: {
    fieldName: string
    oldValue: string | null     // JSON stringified
    newValue: string | null
  }[]
  metadata?: {
    ipAddress?: string
    userAgent?: string
    duration?: number
  }
}
```

## Usage

```typescript
// Query events (direct endpoint — no generated collection needed)
const { data: enriched } = useCroutonEvents({
  filters: { collectionName: 'users', operation: 'update' },
  pagination: { page: 1, pageSize: 50 }
})

```

## Admin UI Components

Ready-to-use components for building an activity/audit interface:

```vue
<!-- Full activity log page with filters and pagination -->
<CroutonActivityLog />

<!-- Timeline visualization (embed in your own layout) -->
<CroutonActivityTimeline :events="events" @view="openDetail" />

<!-- Individual timeline item -->
<CroutonActivityTimelineItem :event="event" />

<!-- Filter controls -->
<CroutonActivityFilters v-model="filters" :collections="collections" />

<!-- Event detail modal -->
<CroutonEventDetail v-model:open="isOpen" :event="selectedEvent" />

<!-- Before/after changes table -->
<CroutonEventChangesTable :changes="event.changes" :before-data="event.beforeData" />
```

### Export Functionality

```typescript
// Use the export composable
const { exportToCSV, exportToJSON, exporting } = useCroutonEventsExport()

// Download with current filters
await exportToCSV({ filters })
await exportToJSON({ filters })
```

## Common Tasks

### Disable tracking for specific collection
Modify the event listener plugin to filter by collection name.

### Add custom metadata
Extend the event schema to include additional fields.

### Export audit trail
Query events with filters and export as JSON/CSV.

## Dependencies

- **Extends**: `@fyit/crouton-core` (required)
- **Peer deps**: `nuxt ^4.0.0`, `@nuxt/ui ^4.0.0`

## Storage Estimate

- CREATE: ~500 bytes
- UPDATE: ~200-400 bytes (changed fields only)
- DELETE: ~150 bytes
- **10,000 events ≈ 3-5 MB**

## Testing

```bash
npx nuxt typecheck  # MANDATORY after changes
```
