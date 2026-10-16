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
4. **Proxy Transform**: Applies external collection transforms if configured

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

### With External Collections (Proxy)

For collections that proxy external APIs:

```typescript
// app.config.ts
export default defineAppConfig({
  croutonCollections: {
    externalUsers: {
      fetchStrategy: 'query',
      proxy: {
        enabled: true,
        sourceEndpoint: 'external-users', // Proxies to external API
        transform: (item) => ({
          id: item.user_id,
          title: item.full_name,
          email: item.email_address
        })
      }
    }
  }
})
```

```vue
<script setup lang="ts">
// Transform is applied automatically
const { item, pending } = await useCollectionItem('externalUsers', '123')
// item.value = { id: '123', title: 'John Doe', email: 'john@example.com' }
</script>
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
  componentName?: string
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
  componentMap: Record<string, string>
  dependentFieldComponentMap: Record<string, Record<string, string>>
  getConfig: (name: string) => CollectionConfig | undefined
  configs: Record<string, CollectionConfig>
}
```

### Returns

- **componentMap** - Map of collection names to form component names
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

### Accessing Component Maps

```vue
<script setup lang="ts">
const { componentMap } = useCollections()

// Get form component name for a collection
const formComponent = componentMap['shopProducts']
console.log(formComponent) // 'ShopProductsForm'

// Dynamically load the form component
const FormComponent = resolveComponent(formComponent)
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
      componentName: 'ShopProductsForm',
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
      componentName: 'ShopCategoriesForm'
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
- ❌ Modify `componentMap` or `dependentFieldComponentMap` directly
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

```vue
<script setup lang="ts">
const { componentMap } = useCollections()

// Check if component is registered
if (!componentMap['shopProducts']) {
  // Missing componentName in app.config.ts
  // Check your collection config
}
</script>
```

---


---

## Collection Proxy Utilities

Standalone utility functions for external collection proxying with client-side data transformation. These are **not** a composable — they are exported as standalone functions.

### Type Signature

```typescript
interface ProxyConfig {
  enabled: boolean
  sourceEndpoint: string
  transform: (item: any) => { id: string; title: string; [key: string]: any }
}

function applyProxyTransform(data: any, config: any): any
function getProxiedEndpoint(config: any, apiPath: string): string
```

### Functions

- **applyProxyTransform** - Transform external data to Crouton format
- **getProxiedEndpoint** - Get the correct endpoint (proxied or standard)

### Basic Proxy Setup

```typescript
// app.config.ts
import { defineExternalCollection } from '#imports'
import { z } from 'zod'

const membersSchema = z.object({
  id: z.string(),
  title: z.string(),
  email: z.string().optional()
})

export default defineAppConfig({
  croutonCollections: {
    // Proxy existing 'members' API to work with Crouton
    users: defineExternalCollection({
      name: 'users',
      schema: membersSchema,
      proxy: {
        enabled: true,
        sourceEndpoint: 'members',  // Fetches from /api/teams/[id]/members
        transform: (item) => ({
          id: item.userId,           // Map userId → id
          title: item.fullName,      // Map fullName → title
          email: item.email
        })
      }
    })
  }
})
```

### Transform Arrays

```vue
<script setup lang="ts">
// applyProxyTransform is auto-imported from @fyit/crouton-core

// External API response
const externalData = [
  { userId: '1', fullName: 'Alice Smith', email: 'alice@example.com' },
  { userId: '2', fullName: 'Bob Jones', email: 'bob@example.com' }
]

// Collection config with proxy
const config = {
  proxy: {
    enabled: true,
    sourceEndpoint: 'members',
    transform: (item: any) => ({
      id: item.userId,
      title: item.fullName,
      email: item.email
    })
  }
}

// Apply transformation
const transformed = applyProxyTransform(externalData, config)
// Result:
// [
//   { id: '1', title: 'Alice Smith', email: 'alice@example.com' },
//   { id: '2', title: 'Bob Jones', email: 'bob@example.com' }
// ]
</script>
```

### Transform Single Items

```vue
<script setup lang="ts">
// applyProxyTransform is auto-imported from @fyit/crouton-core

// Single item from external API
const externalItem = {
  userId: '1',
  fullName: 'Alice Smith',
  department: 'Engineering'
}

const config = {
  proxy: {
    enabled: true,
    sourceEndpoint: 'members',
    transform: (item: any) => ({
      id: item.userId,
      title: `${item.fullName} (${item.department})`
    })
  }
}

const transformed = applyProxyTransform(externalItem, config)
// Result: { id: '1', title: 'Alice Smith (Engineering)' }
</script>
```

### Get Proxied Endpoint

```vue
<script setup lang="ts">
// getProxiedEndpoint is auto-imported from @fyit/crouton-core

// Without proxy
const config1 = {
  apiPath: 'users'
}
const endpoint1 = getProxiedEndpoint(config1, 'users')
// Returns: 'users' → /api/teams/[id]/users

// With proxy enabled
const config2 = {
  apiPath: 'users',
  proxy: {
    enabled: true,
    sourceEndpoint: 'members'
  }
}
const endpoint2 = getProxiedEndpoint(config2, 'users')
// Returns: 'members' → /api/teams/[id]/members
</script>
```

### Integration with Data Fetching

```vue
<script setup lang="ts">
// This is how useCollectionQuery uses the proxy internally
const { getConfig } = useCollections()
// applyProxyTransform and getProxiedEndpoint are auto-imported from @fyit/crouton-core

const collection = 'users'
const config = getConfig(collection)

// Get the correct endpoint (proxied or standard)
const apiPath = getProxiedEndpoint(config, config.apiPath || collection)

// Fetch from the proxied endpoint
const { data } = await $fetch(`/api/teams/123/${apiPath}`)

// Transform the response
const transformedData = applyProxyTransform(data, config)

// Now transformedData has Crouton format: { id, title, ... }
</script>
```

### Complex Transform Examples

**Map nested properties:**

```typescript
proxy: {
  enabled: true,
  sourceEndpoint: 'members',
  transform: (item) => ({
    id: item.user.id,
    title: `${item.user.firstName} ${item.user.lastName}`,
    email: item.user.contact.email,
    role: item.membership.role,
    joinedAt: item.membership.createdAt
  })
}
```

**Conditional transformations:**

```typescript
proxy: {
  enabled: true,
  sourceEndpoint: 'products',
  transform: (item) => ({
    id: item.sku,
    title: item.isActive ? `✅ ${item.name}` : `❌ ${item.name}`,
    status: item.isActive ? 'active' : 'inactive',
    price: item.pricing.amount / 100  // Convert cents to dollars
  })
}
```

**Combine multiple fields:**

```typescript
proxy: {
  enabled: true,
  sourceEndpoint: 'bookings',
  transform: (item) => ({
    id: item.bookingId,
    title: `${item.service} - ${new Date(item.startTime).toLocaleDateString()}`,
    customerName: `${item.customer.firstName} ${item.customer.lastName}`,
    duration: item.endTime - item.startTime
  })
}
```

### Error Handling

The proxy automatically handles transform errors:

```vue
<script setup lang="ts">
// applyProxyTransform is auto-imported from @fyit/crouton-core

// Malformed data
const badData = [
  { userId: '1', fullName: 'Alice' },  // Valid
  null,                                  // Invalid
  { userId: '2' }                        // Missing fullName
]

const config = {
  proxy: {
    enabled: true,
    sourceEndpoint: 'members',
    transform: (item: any) => ({
      id: item.userId,
      title: item.fullName.toUpperCase()  // Will throw on missing fullName
    })
  }
}

// Transform with error handling
const result = applyProxyTransform(badData, config)
// Logs error: "[applyProxyTransform] Transform failed for item: ..."
// Returns partially transformed data (failed items remain unchanged)
</script>
```

### When to Use Proxy

**Use proxy when:**
- ✅ Connecting to existing APIs (auth, external services)
- ✅ API uses different field names (`userId` vs `id`)
- ✅ Need to combine/compute fields for display
- ✅ Working with third-party integrations

**Don't use proxy when:**
- ❌ You control the API and can return Crouton format directly
- ❌ No transformation needed
- ❌ Data structure matches Crouton expectations

### Best Practices

**DO:**
- ✅ Always return `{ id, title, ...otherFields }` from transform
- ✅ Handle missing fields gracefully in transform function
- ✅ Use `defineExternalCollection()` helper for proxy setup
- ✅ Test transforms with real API data

**DON'T:**
- ❌ Throw errors in transform functions (use try/catch)
- ❌ Perform async operations in transform (use computed fields instead)
- ❌ Mutate the original item data

### Troubleshooting

**Problem**: Transform not being applied

```typescript
// ❌ BAD: proxy.enabled is false or missing
proxy: {
  sourceEndpoint: 'members',
  transform: (item) => ({ ... })
}

// ✅ GOOD: explicitly enable
proxy: {
  enabled: true,
  sourceEndpoint: 'members',
  transform: (item) => ({ ... })
}
```

**Problem**: Missing `id` or `title` field

```typescript
// ❌ BAD: Missing required fields
transform: (item) => ({
  userId: item.id,  // Wrong! Must be 'id'
  name: item.name   // Wrong! Must be 'title'
})

// ✅ GOOD: Include required fields
transform: (item) => ({
  id: item.userId,
  title: item.name,
  // ... other fields
})
```

---


---

## useExternalCollection

Define and register external collections that are managed outside of Crouton (e.g., users from auth system, third-party APIs).

### Type Signature

```typescript
interface ExternalCollectionConfig {
  name: string
  schema: z.ZodSchema
  apiPath?: string
  fetchStrategy?: 'query' | 'restful'
  readonly?: boolean
  meta?: {
    label?: string
    description?: string
  }
  proxy?: {
    enabled: boolean
    sourceEndpoint: string
    transform: (item: any) => { id: string; title: string; [key: string]: any }
  }
}

function defineExternalCollection(config: ExternalCollectionConfig): CollectionConfig
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Collection identifier (must match app.config.ts key) |
| `schema` | `z.ZodSchema` | Yes | - | Zod validation schema for items |
| `apiPath` | `string` | No | `name` | API endpoint path |
| `fetchStrategy` | `'query' \| 'restful'` | No | `'query'` | How to fetch single items: ?ids= vs /{id} |
| `readonly` | `boolean` | No | `true` | Hide edit/delete in UI (read-only mode) |
| `meta.label` | `string` | No | - | Display label for collection |
| `meta.description` | `string` | No | - | Description of collection |
| `proxy.enabled` | `boolean` | No | - | Enable proxy to different endpoint |
| `proxy.sourceEndpoint` | `string` | No | - | Endpoint to proxy (e.g., 'members' → /api/teams/[id]/members) |
| `proxy.transform` | `function` | No | - | Transform source data to Crouton format |

### Returns

A collection configuration object compatible with Crouton registry. Returns object with:
- `name`: Collection name
- `layer`: 'external'
- `apiPath`: API endpoint
- `fetchStrategy`: Query or REST strategy
- `readonly`: Read-only flag
- `componentName`: null (read-only)
- `schema`: Zod schema for validation
- `defaultValues`: Empty object
- `columns`: Empty array
- `meta`: Metadata object
- `proxy`: Proxy configuration

### Basic Usage

Simple external users collection:

```typescript
// utils/collections.ts
import { z } from 'zod'
import { defineExternalCollection } from '#imports'

const userSchema = z.object({
  id: z.string(),
  title: z.string(), // Required for display in selects
  email: z.string().email().optional(),
  avatarUrl: z.string().optional()
})

export const usersConfig = defineExternalCollection({
  name: 'users',
  schema: userSchema,
  readonly: true, // Don't allow editing
  meta: {
    label: 'Team Users',
    description: 'Users from your authentication system'
  }
})
```

Register in app.config:

```typescript
// app.config.ts
import { usersConfig } from '~/utils/collections'

export default defineAppConfig({
  croutonCollections: {
    users: usersConfig,
    // ... other collections
  }
})
```

### With Custom API Path

Map collection name to different endpoint:

```typescript
export const authUsersConfig = defineExternalCollection({
  name: 'authUsers',
  schema: userSchema,
  apiPath: 'api/auth/users', // Different from collection name
  readonly: true
})
```

### REST Fetch Strategy

Use RESTful endpoints for single item fetching:

```typescript
// Users collection using /api/users/:id
export const usersConfig = defineExternalCollection({
  name: 'users',
  schema: userSchema,
  fetchStrategy: 'restful', // Use /api/users/123 instead of /api/users?ids=123
  readonly: true
})
```

### With Proxy Configuration

Fetch from nested endpoint with transformation:

```typescript
const teamMembersConfig = defineExternalCollection({
  name: 'teamMembers',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    role: z.string().optional()
  }),
  readonly: true,
  proxy: {
    enabled: true,
    // Endpoint transforms: 'members' → /api/teams/:teamId/members
    sourceEndpoint: 'members',
    // Transform from source format to Crouton format
    transform: (item: any) => ({
      id: item.userId,
      title: item.userName,
      role: item.userRole
    })
  }
})
```

### Using in CroutonReferenceSelect

Reference external collection in forms:

```vue
<script setup lang="ts">
import { usersConfig } from '~/utils/collections'

const formData = ref({
  assignedUser: null
})
</script>

<template>
  <!-- CroutonReferenceSelect automatically finds 'users' external collection -->
  <CroutonReferenceSelect 
    v-model="formData.assignedUser"
    collection="users"
    label="Assign to User"
  />
</template>
```

### Multiple External Collections

::callout{icon="i-lucide-book-open" color="blue"}
For complete schema definitions and examples, see the [Basic Usage](#basic-usage) section above.
::

Register several external sources:

```typescript
// app.config.ts
import { z } from 'zod'
import { defineExternalCollection } from '#imports'

// Define schemas (see Basic Usage for full examples)
const userSchema = z.object({ /* ... */ })
const departmentSchema = z.object({ /* ... */ })

export default defineAppConfig({
  croutonCollections: {
    users: defineExternalCollection({
      name: 'users',
      schema: userSchema,
      meta: { label: 'Team Users' }
    }),
    departments: defineExternalCollection({
      name: 'departments',
      schema: departmentSchema,
      meta: { label: 'Organization Departments' }
    })
  }
})
```

### Best Practices

**DO:**
- ✅ Always include `title` field in schema (required for UI display)
- ✅ Set `readonly: true` for external system data (prevent accidental mutations)
- ✅ Provide clear `meta.label` and `meta.description`
- ✅ Use query strategy for most cases (simpler)
- ✅ Test schema validation with actual API responses
- ✅ Use proxy with transform for complex data structures

**DON'T:**
- ❌ Forget `title` field (breaks CroutonReferenceSelect)
- ❌ Set `readonly: false` for system collections (causes data inconsistency)
- ❌ Use complex nested schemas (transform at proxy layer instead)
- ❌ Assume API returns exact Crouton format (use proxy.transform)
- ❌ Mix external and managed collections in same references

### Common Patterns

#### Authentication System Users

```typescript
export const authUsersConfig = defineExternalCollection({
  name: 'authUsers',
  schema: z.object({
    id: z.string().uuid(),
    title: z.string(), // Display name
    email: z.string().email(),
    role: z.enum(['admin', 'user', 'guest']).optional()
  }),
  apiPath: 'api/auth/users',
  readonly: true
})
```

#### Third-Party API Integration

```typescript
export const externalVendorsConfig = defineExternalCollection({
  name: 'vendors',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    vendorCode: z.string().optional()
  }),
  apiPath: 'https://external-api.com/vendors',
  fetchStrategy: 'restful'
})
```

#### Nested Endpoint Transformation

```typescript
export const projectMembersConfig = defineExternalCollection({
  name: 'projectMembers',
  schema: z.object({
    id: z.string(),
    title: z.string()
  }),
  proxy: {
    enabled: true,
    sourceEndpoint: 'members',
    transform: (member: any) => ({
      id: member.memberId.toString(),
      title: `${member.firstName} ${member.lastName}`
    })
  }
})
```

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| CroutonReferenceSelect empty | `title` field missing from schema | Add required `title: z.string()` to schema |
| API 404 errors | Wrong apiPath or endpoint | Verify apiPath matches actual API route |
| Transform not running | proxy.enabled false or not set | Ensure `proxy.enabled: true` |
| Data shows incorrectly | Schema validation failing | Validate schema matches actual API response |
| Can't edit items | readonly: true (expected) | Set `readonly: false` if editable (risk: data inconsistency) |

## Related Resources

- [Query Composables](/api-reference/composables/query-composables) - Advanced data fetching
- [Mutation Composables](/api-reference/composables/mutation-composables) - Data mutations
- [Collections Guide](/fundamentals/collections) - Understanding collections
