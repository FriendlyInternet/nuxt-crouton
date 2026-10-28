---
title: Data Composables
description: Fetch and manage collection data with automatic caching and reactivity
icon: i-lucide-database
---

::callout{type="tip" icon="i-lucide-book-open"}
**Query Examples**: For complete `useCollectionQuery` patterns (basic, filtering, pagination, sorting, relations), see [Querying Data](/fundamentals/querying).
::

## ~~useCollection~~ (Removed)

::callout{icon="i-lucide-triangle-alert" color="red"}
**Removed**: `useCollection()` has been removed. Use `useCollectionQuery()` for data fetching or `useCollections()` for collection configuration.
::

---

## useCollectionItem

Fetch a single collection item by ID with support for both RESTful and query-based strategies.

### Type Signature

```typescript
interface CollectionItemReturn<T = any> {
  item: ComputedRef<T | null>
  pending: Ref<boolean>
  error: Ref<any>
  refresh: () => Promise<void>
}

function useCollectionItem<T = any>(
  collection: string,
  id: string | Ref<string> | (() => string)
): Promise<CollectionItemReturn<T>>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `collection` | `string` | Yes | The collection name (e.g., 'users', 'bookingsLocations') |
| `id` | `string \| Ref<string> \| (() => string)` | Yes | Item ID - can be static string, reactive ref, or getter function |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `item` | `ComputedRef<T \| null>` | The fetched item (typed via generic) |
| `pending` | `Ref<boolean>` | Loading state during fetch |
| `error` | `Ref<any>` | Error state if fetch fails |
| `refresh` | `() => Promise<void>` | Manual refetch function |

### How It Works

1. **Fetch Strategy Detection**: Uses collection config to determine endpoint pattern
   - **RESTful**: `/api/teams/:teamId/:collection/:id` (single object response)
   - **Query-based**: `/api/teams/:teamId/:collection?ids=:id` (array response, extracts first)
2. **Reactive ID**: Watches for ID changes and automatically refetches
3. **Team Context**: Automatically resolves team ID from route or `useTeam()` composable

### Fetch Strategies

Collections can use two different fetch strategies defined in `app.config.ts`:

```typescript
// app.config.ts
export default defineAppConfig({
  croutonCollections: {
    // RESTful strategy (default for most collections)
    users: {
      fetchStrategy: 'restful', // GET /api/teams/123/users/456 → { id, name, ... }
      // ...
    },
    
    // Query-based strategy (for external APIs or batch endpoints)
    bookingsBookings: {
      fetchStrategy: 'query', // GET /api/teams/123/bookings?ids=456 → [{ id, name, ... }]
      // ...
    }
  }
})
```

::callout{type="tip" icon="i-lucide-book-open"}
**Complete Examples**: For comprehensive `useCollectionItem` patterns including basic usage, reactive IDs, error handling, and TypeScript examples, see the [useCollectionItem API Reference](/api-reference/use-collection-item).
::

### In Card Components

Common pattern for rendering referenced items (e.g., showing location details in a booking):

```vue
<script setup lang="ts">
// ItemCardMini.vue (real example from codebase)
const props = defineProps<{
  id: string
  collection: string
}>()

const { item, pending, error } = await useCollectionItem(
  props.collection,
  computed(() => props.id)
)
</script>

<template>
  <UBadge v-if="pending" color="neutral">
    <USkeleton class="h-4 w-full" />
  </UBadge>
  
  <UBadge v-else-if="item" color="neutral">
    {{ item.title }}
  </UBadge>
  
  <UBadge v-else-if="error" color="red">
    Error loading
  </UBadge>
</template>
```

Usage:
```vue
<template>
  <!-- Show location name for booking.location ID -->
  <CroutonItemCardMini
    :id="booking.location"
    collection="bookingsLocations"
  />
</template>
```

### Team Context Resolution

The composable automatically resolves the correct team ID:

```typescript
// In team-based route: /dashboard/:team/users/:id
const { item } = await useCollectionItem('users', '123')
// → Fetches from: /api/teams/{resolvedTeamId}/users/123

// In super-admin route: /super-admin/users/:id
const { item } = await useCollectionItem('users', '123')
// → Fetches from: /api/super-admin/users/123
```

**Resolution Strategy:**
1. Try `useTeam()` composable → returns `currentTeam.id` (preferred)
2. Fallback to `route.params.team` (might be slug or ID)

### Cache Invalidation

After mutations, individual item caches are automatically refreshed:

```vue
<script setup lang="ts">
// Fetch user
const { item, pending } = await useCollectionItem('users', '123')

// Mutate user
const { update } = useCollectionMutation('users')
await update('123', { name: 'Updated Name' })

// ✅ item.value automatically refreshes with new data
// No manual refresh needed!
</script>
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Item not refetching when ID changes | Use `computed(() => props.id)` or `ref`, not a plain string |
| Wrong fetch strategy (404 errors) | Check `fetchStrategy` in collection config (`app.config.ts`) |
| Team context errors | Ensure route has `:team` param or `useTeam()` is available |
| Transform not applied | Check `proxy.enabled` and `proxy.transform` in config |
| SSR hydration mismatch | Use `computed(() => props.id)` instead of arrow function `() => props.id` |

---



---

## useCollections

Access the central collection registry and configuration management system.

### Type Signature

```typescript
interface CollectionConfig {
  name?: string
  layer?: string
  apiPath?: string
  defaultPagination?: {
    currentPage: number
    pageSize: number
    sortBy: string
    sortDirection: 'asc' | 'desc'
  }
  references?: Record<string, string>
  dependentFieldComponents?: Record<string, string>
  [key: string]: any
}

function useCollections(): {
  dependentFieldComponentMap: Record<string, Record<string, string>>
  getConfig: (name: string) => CollectionConfig | undefined
  configs: Record<string, CollectionConfig>
}
```

### Returns

- **dependentFieldComponentMap** - Map of collections to their custom field components
- **getConfig** - Get configuration for a specific collection
- **configs** - Full registry of all collection configurations

### Basic Usage

```vue
<script setup lang="ts">
const { getConfig, configs } = useCollections()

// Get configuration for a specific collection
const productsConfig = getConfig('shopProducts')
console.log(productsConfig?.apiPath) // '/api/crouton-collection/shopProducts'
console.log(productsConfig?.layer) // 'shop'

// Access all registered collections
const allCollections = Object.keys(configs)
console.log(allCollections) // ['shopProducts', 'shopCategories', ...]
</script>
```

### Working with References

```vue
<script setup lang="ts">
const { getConfig } = useCollections()

// Check collection references for cache invalidation
const config = getConfig('shopProducts')
if (config?.references) {
  console.log(config.references)
  // { categoryId: 'shopCategories', authorId: 'users' }
  
  // When a product is updated, also refresh:
  // - shopCategories cache (if categoryId changed)
  // - users cache (if authorId changed)
}
</script>
```

### Custom Field Components

```vue
<script setup lang="ts">
const { dependentFieldComponentMap, getConfig } = useCollections()

// Get custom component for dependent field
const productsMap = dependentFieldComponentMap['shopProducts']
if (productsMap?.slots) {
  console.log(productsMap.slots) // 'SlotSelect'
  // FormDependentFieldLoader will use SlotSelect component
}

// Alternative: Access via config
const config = getConfig('shopProducts')
const slotComponent = config?.dependentFieldComponents?.slots
</script>
```

### Collection Registry Pattern

Collections are registered in `app.config.ts`:

```typescript
// app.config.ts
export default defineAppConfig({
  croutonCollections: {
    shopProducts: {
      name: 'shopProducts',
      layer: 'shop',
      apiPath: '/api/crouton-collection/shopProducts',
      references: {
        categoryId: 'shopCategories',  // Refresh categories when product changes
        authorId: 'users'               // Refresh users when product changes
      },
      dependentFieldComponents: {
        slots: 'SlotSelect'  // Custom component for 'slots' field
      },
      defaultPagination: {
        currentPage: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortDirection: 'desc'
      }
    },
    shopCategories: {
      name: 'shopCategories',
      layer: 'shop',
      apiPath: '/api/crouton-collection/shopCategories',
    }
  }
})
```

### Integration with Data Fetching

```vue
<script setup lang="ts">
const { getConfig } = useCollections()

// Get collection config
const config = getConfig('shopProducts')
if (!config) {
  throw new Error('Collection not registered')
}

// Use config for data fetching
const { items, pending } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    page: 1,
    pageSize: config.defaultPagination?.pageSize || 20
  }))
})
</script>
```

### Checking Collection Existence

```vue
<script setup lang="ts">
const { getConfig, configs } = useCollections()

// Check if collection is registered
const isRegistered = (name: string) => {
  return getConfig(name) !== undefined
}

if (isRegistered('shopProducts')) {
  // Safe to use collection
}

// Get all collection names
const collectionNames = Object.keys(configs)
console.log('Registered collections:', collectionNames)
</script>
```

### Best Practices

**DO:**
- ✅ Use `getConfig()` to check if collection exists before querying
- ✅ Register collections in `app.config.ts` via generator
- ✅ Define `references` for automatic cache invalidation
- ✅ Use `dependentFieldComponents` for custom field renderers

**DON'T:**
- ❌ Modify `dependentFieldComponentMap` directly
- ❌ Assume a collection exists - always check with `getConfig()`
- ❌ Manually manage collection data state (use `useCollectionQuery` instead)

### Troubleshooting

**Problem**: `getConfig()` returns `undefined`

```vue
<script setup lang="ts">
const { getConfig } = useCollections()
const config = getConfig('myCollection')

if (!config) {
  // Collection not registered in app.config.ts
  // Run: npx crouton-generate config crouton.config.js
  throw new Error('Collection not found')
}
</script>
```

**Problem**: Form component not loading

The form is looked up by name: `<Layer><Plural>Form` (e.g. `ShopProductsForm`). Check that a component with that exact name exists — see [Replace a form or list](/customization/eject).

---


---

## Related Resources

- [Query Composables](/api-reference/composables/query-composables) - Advanced data fetching
- [Mutation Composables](/api-reference/composables/mutation-composables) - Data mutations
- [Collections Guide](/fundamentals/collections) - Understanding collections
