# @fyit/crouton-events

Event tracking and audit trail for Nuxt Crouton collections. Automatically tracks all CREATE, UPDATE, and DELETE operations across your collections.

## Features

- **Automatic Tracking**: Hooks into `nuxt-crouton` mutations with zero configuration
- **Smart Diff**: Stores only changed fields to minimize storage
- **User Attribution**: Captures user ID and username at time of event
- **Historical Accuracy**: Snapshots user data to preserve audit trail
- **Configurable Retention**: Auto-cleanup of old events
- **Standard Collection**: Uses Crouton's scaffolder for consistent UI/API
- **Error Handling**: Development-friendly error visibility with production safety

## Installation

```bash
pnpm add @fyit/crouton-events
```

## Setup

Add to your Nuxt layers:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  extends: [
    '@fyit/crouton-core',
    '@fyit/crouton-events' // Add this
  ]
})
```

That's it! Events are now automatically tracked for all collection mutations.

## Configuration

Customize behavior in your `nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      croutonEvents: {
        enabled: true,                    // Enable/disable tracking
        snapshotUserName: true,           // Store username for audit trail
        errorHandling: {
          mode: 'toast',                  // 'silent' | 'toast' | 'throw'
          logToConsole: true              // Log errors to console
        },
        retention: {
          enabled: true,                  // Auto-cleanup old events
          days: 90,                       // Keep events for 90 days
          maxEvents: 100000               // Or max number of events
        }
      }
    }
  }
})
```

## Event Schema

Each tracked event contains:

```typescript
interface CroutonEvent {
  id: string
  timestamp: Date
  operation: 'create' | 'update' | 'delete'
  collectionName: string
  itemId: string
  teamId: string
  userId: string
  userName: string
  changes: {
    fieldName: string
    oldValue: string | null    // JSON stringified
    newValue: string | null    // JSON stringified
  }[]
  metadata?: {
    ipAddress?: string
    userAgent?: string
    duration?: number
  }
}
```

## Usage

### Query Events

```typescript
// Get all events
const { data: events, pending } = await useCollectionQuery('collectionEvents', {
  teamId: currentTeam.id
})

// Filter by collection
const { data: userEvents } = await useCollectionQuery('collectionEvents', {
  teamId: currentTeam.id,
  filters: {
    collectionName: 'users'
  }
})

// Filter by operation
const { data: updates } = await useCollectionQuery('collectionEvents', {
  teamId: currentTeam.id,
  filters: {
    operation: 'update'
  }
})
```

### Enriched Queries (with User JOIN)

Get current user data alongside historical snapshot:

```typescript
const { data: enrichedEvents } = await useCroutonEvents({
  enrichUserData: true
})

// enrichedEvents[0].userName = "John Smith" (at time of event)
// enrichedEvents[0].user.currentName = "Jane Doe" (current)
// enrichedEvents[0].user.email = "jane@example.com"
```

### View Events in UI

The package generates a standard Crouton collection with List component:

```vue
<template>
  <CroutonEventsCollectionEventsList />
</template>
```

## Architecture

### How It Works

1. **Core Hooks**: `nuxt-crouton` emits `crouton:mutation` hooks after successful CRUD operations
2. **Event Listener**: This package subscribes to those hooks via a Nuxt plugin
3. **Smart Diff**: Calculates field-level changes (old value → new value)
4. **Async Tracking**: Events are tracked in the background without blocking user operations
5. **Storage**: Events stored in same database as collections (NuxtHub D1/SQLite)

### Performance

- **Non-blocking**: Events tracked asynchronously after mutation completes
- **Minimal overhead**: Smart diff stores only changed fields
- **Indexed queries**: Fast filtering by collection, user, date
- **Auto-cleanup**: Configurable retention prevents database bloat

Storage estimate:
- CREATE: ~500 bytes (all fields)
- UPDATE: ~200-400 bytes (changed fields only)
- DELETE: ~150 bytes (minimal data)
- **10,000 events ≈ 3-5 MB**

## Development

### Error Visibility

In development mode, failed tracking shows toast notifications:

```
⚠️ Event tracking failed
Description: Network error or validation failure
```

In production, errors are silently logged to console without disrupting user experience.

### Health Monitoring

Check tracking health:

```typescript
const { data: health } = useCroutonEventsHealth()

// health.total = 1000
// health.failed = 5
// health.lastError = "Network timeout"
```

## License

MIT
