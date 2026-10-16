---
title: Layout Components
description: Container and card components for organizing content
icon: i-lucide-layout-grid
---

::callout{type="tip" icon="i-lucide-book-open"}
**Query Examples**: For complete `useCollectionQuery` patterns (basic, filtering, pagination, sorting, relations), see [Querying Data](/fundamentals/querying).
::

## CroutonCollection

The unified collection display component that supports multiple layout modes (table, list, grid, cards) with responsive breakpoint support. This is the recommended component for displaying collection data.

::callout{icon="i-lucide-info" color="blue"}
**CroutonCollection** is the primary component for rendering collections, with responsive layouts, custom card components, and grid/cards support.
::

### Props

```typescript
interface CollectionProps {
  // Layout Configuration
  layout?: LayoutType | ResponsiveLayout | keyof typeof layoutPresets

  // Data
  rows?: any[]
  columns?: TableColumn[]
  collection: string

  // Pagination
  serverPagination?: boolean
  paginationData?: PaginationData | null
  refreshFn?: () => Promise<void> | null

  // UI Options
  create?: boolean
  hideDefaultColumns?: {
    createdAt?: boolean
    updatedAt?: boolean
    createdBy?: boolean
    updatedBy?: boolean
    select?: boolean
    presence?: boolean
    actions?: boolean
  }
}

// Layout Types
type LayoutType = 'table' | 'list' | 'grid' | 'tree' | 'kanban' | 'workspace'

interface ResponsiveLayout {
  base: LayoutType
  sm?: LayoutType
  md?: LayoutType
  lg?: LayoutType
  xl?: LayoutType
  '2xl'?: LayoutType
}

// Layout Presets
const layoutPresets = {
  'responsive': { base: 'list', md: 'grid', lg: 'table' },
  'mobile-friendly': { base: 'list', lg: 'table' },
  'compact': { base: 'list', xl: 'table' }
}
```

#### Prop Details

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `layout` | `LayoutType \| ResponsiveLayout \| string` | `'table'` | Layout mode, responsive object, or preset name |
| `rows` | `any[]` | `[]` | Data rows to display |
| `columns` | `TableColumn[]` | `[]` | Column definitions |
| `collection` | `string` | *required* | Collection name for card resolution and actions |
| `serverPagination` | `boolean` | `false` | Enable server-side pagination |
| `paginationData` | `PaginationData \| null` | `null` | Pagination metadata |
| `refreshFn` | `() => Promise<void>` | `undefined` | Function to refresh data |
| `create` | `boolean` | `false` | Show create button in header |
| `hideDefaultColumns` | `object` | `{}` | Hide specific default columns |

### Slots

#### `header` (Scoped)

Customize the header content. By default, shows `CroutonTableHeader` with optional create button.

```vue
<template #header>
  <div class="flex items-center justify-between p-4">
    <h2 class="text-xl font-bold">My Custom Header</h2>
    <UButton @click="exportData">Export</UButton>
  </div>
</template>
```

#### Dynamic Data Slots (Pass-through)

All other slots are passed through to child components for custom cell rendering:

```vue
<template #location-cell="{ row }">
  <CroutonItemCardMini
    :id="row.original.location"
    collection="locations"
  />
</template>

<template #date-cell="{ row }">
  <CroutonDate :date="row.original.date" />
</template>
```

### Basic Usage

```vue
<template>
  <CroutonCollection
    layout="table"
    collection="bookings"
    :columns="columns"
    :rows="bookings"
    create
  />
</template>

<script setup lang="ts">
const { items: bookings, pending } = await useCollectionQuery('bookings')

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'date', header: 'Date' }
]
</script>
```

### Layout Modes

#### Table Layout

Ideal for data-dense views with sorting, filtering, and pagination:

```vue
<CroutonCollection
  layout="table"
  collection="users"
  :columns="columns"
  :rows="users"
/>
```

#### List Layout

Optimized for mobile devices with automatic field detection:

```vue
<CroutonCollection
  layout="list"
  collection="bookings"
  :columns="columns"
  :rows="bookings"
/>
```

**Auto-detected fields** (priority order):
- **Title**: `name`, `title`, `label`, `email`, `username`, `id`
- **Subtitle**: `description`, `email`, `username`, `role`, `createdAt`
- **Avatar**: `avatar`, `image`, `avatarUrl`, `profileImage`

#### Grid Layout

CSS grid with 2-4 columns depending on screen size:

```vue
<CroutonCollection
  layout="grid"
  collection="products"
  :columns="columns"
  :rows="products"
/>
```

Renders: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`

#### Cards Layout

Card-based layout with 1-3 columns:

```vue
<CroutonCollection
  layout="cards"
  collection="projects"
  :columns="columns"
  :rows="projects"
/>
```

Renders: `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`

### Responsive Layouts

#### Using Responsive Object

Define different layouts for different screen sizes:

```vue
<CroutonCollection
  :layout="{
    base: 'list',    // Mobile
    md: 'grid',      // Tablet
    lg: 'table'      // Desktop
  }"
  collection="locations"
  :columns="columns"
  :rows="locations"
/>
```

#### Using Layout Presets

Choose from predefined responsive patterns:

```vue
<!-- Preset: 'responsive' (list → grid → table) -->
<CroutonCollection
  layout="responsive"
  collection="bookings"
  :columns="columns"
  :rows="bookings"
/>

<!-- Preset: 'mobile-friendly' (list → table) -->
<CroutonCollection
  layout="mobile-friendly"
  collection="users"
  :columns="columns"
  :rows="users"
/>

<!-- Preset: 'compact' (list → table at xl) -->
<CroutonCollection
  layout="compact"
  collection="activities"
  :columns="columns"
  :rows="activities"
/>
```

### Custom Card Components

For `list`, `grid`, and `cards` layouts, CroutonCollection automatically looks for custom card components matching your collection name:

**Expected file location:**
```
layers/{layer}/collections/{collection}/app/components/Card.vue
```

**Example Card Component:**

```vue
<!-- layers/bookings/collections/bookings/app/components/Card.vue -->
<script setup lang="ts">
interface Props {
  item: any
  layout: 'list' | 'grid' | 'kanban'
  collection: string
}

const props = defineProps<Props>()
</script>

<template>
  <!-- List Layout (compact) -->
  <div v-if="layout === 'list'" class="flex items-center gap-3 p-3">
    <UAvatar :src="item.avatar" :alt="item.name" />
    <div>
      <div class="font-semibold">{{ item.name }}</div>
      <div class="text-sm text-gray-500">{{ item.email }}</div>
    </div>
  </div>

  <!-- Grid Layout (medium cards) -->
  <UCard v-else-if="layout === 'grid'">
    <div class="space-y-2">
      <h3 class="font-semibold">{{ item.name }}</h3>
      <p class="text-sm text-gray-600">{{ item.description }}</p>
    </div>
  </UCard>

  <!-- Cards Layout (large cards) -->
  <UCard v-else-if="layout === 'kanban'">
    <div class="space-y-3">
      <UAvatar :src="item.avatar" :alt="item.name" size="lg" />
      <h3 class="text-lg font-bold">{{ item.name }}</h3>
      <p>{{ item.description }}</p>
      <div class="flex gap-2">
        <UBadge>{{ item.status }}</UBadge>
        <UBadge color="gray">{{ item.role }}</UBadge>
      </div>
    </div>
  </UCard>
</template>
```

**Component Resolution:**

```typescript
// Collection: "bookingsBookings"
// Resolves to: "BookingsBookingsCard"
// Expected: layers/bookings/collections/bookings/app/components/Card.vue
```

::callout{icon="i-lucide-lightbulb" color="amber"}
If no custom card component is found, CroutonCollection displays helpful developer guidance with the expected file path and example code structure.
::

### Server Pagination

Enable server-side pagination for large datasets:

```vue
<template>
  <CroutonCollection
    layout="table"
    collection="users"
    :columns="columns"
    :rows="users"
    server-pagination
    :pagination-data="paginationData"
    :refresh-fn="refreshUsers"
  />
</template>

<script setup lang="ts">
const page = ref(1)
const pageSize = ref(10)

const { data: response, pending, refresh: refreshUsers } = await useFetch('/api/users', {
  query: { page, pageSize }
})

const users = computed(() => response.value?.items || [])
const paginationData = computed(() => ({
  currentPage: response.value?.page || 1,
  pageSize: response.value?.pageSize || 10,
  totalItems: response.value?.total || 0,
  totalPages: Math.ceil((response.value?.total || 0) / pageSize.value)
}))

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' }
]
</script>
```

### Custom Cell Rendering

Use scoped slots for custom cell content:

```vue
<CroutonCollection
  layout="table"
  collection="bookings"
  :columns="columns"
  :rows="bookings"
>
  <!-- Related entity display -->
  <template #location-cell="{ row }">
    <CroutonItemCardMini
      :id="row.original.location"
      collection="locations"
    />
  </template>

  <!-- Date formatting -->
  <template #date-cell="{ row }">
    <CroutonDate :date="row.original.date" format="long" />
  </template>

  <!-- Status badge -->
  <template #status-cell="{ row }">
    <UBadge
      :color="row.original.status === 'active' ? 'green' : 'gray'"
    >
      {{ row.original.status }}
    </UBadge>
  </template>
</CroutonCollection>
```

### Multi-Collection Dashboard

Display multiple collections side by side.

#### Single Collection Dashboard

```vue
<template>
  <CroutonCollection
    layout="list"
    collection="bookings"
    :columns="columns"
    :rows="recentBookings"
    create
  >
    <template #header>
      <div class="p-4">
        <h2 class="font-bold">Recent Bookings</h2>
      </div>
    </template>
  </CroutonCollection>
</template>

<script setup lang="ts">
const { items: bookings } = await useCollectionQuery('bookings')
const recentBookings = computed(() => bookings.value.slice(0, 8))

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'date', header: 'Date' }
]
</script>
```

#### Multi-Collection Dashboard

```vue
<template>
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <CroutonCollection
      layout="list"
      collection="bookings"
      :columns="bookingsColumns"
      :rows="recentBookings"
      create
    >
      <template #header>
        <div class="p-4"><h2 class="font-bold">Recent Bookings</h2></div>
      </template>
    </CroutonCollection>

    <CroutonCollection
      layout="list"
      collection="locations"
      :columns="locationsColumns"
      :rows="activeLocations"
    >
      <template #header>
        <div class="p-4"><h2 class="font-bold">Active Locations</h2></div>
      </template>
    </CroutonCollection>
  </div>
</template>

<script setup lang="ts">
const { items: bookings } = await useCollectionQuery('bookings')
const { items: locations } = await useCollectionQuery('locations')

const recentBookings = computed(() => bookings.value.slice(0, 8))
const activeLocations = computed(() => locations.value.slice(0, 8))

const bookingsColumns = [{ accessorKey: 'name', header: 'Name' }]
const locationsColumns = [{ accessorKey: 'name', header: 'Location' }]
</script>
```

### Hide Default Columns

Control visibility of automatically-added columns:

```vue
<CroutonCollection
  layout="table"
  collection="products"
  :columns="columns"
  :rows="products"
  :hide-default-columns="{
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    updatedBy: true,
    actions: false  // Keep actions column
  }"
/>
```

### Create Button Integration

The `create` prop adds a button that automatically opens the appropriate form modal:

```vue
<CroutonCollection
  layout="table"
  collection="bookings"
  :columns="columns"
  :rows="bookings"
  create
/>
```

This internally calls:
```typescript
const { open } = useCrouton()
open('create', 'bookings')
```

### Complete Example

For a complete working example demonstrating layout switching, search/filters, custom cell renderers, and avatar groups, see this interactive demo:

::callout{type="info" icon="i-lucide-code"}
**[View Full Interactive Demo →](https://stackblitz.com/edit/nuxt-crouton-bookings-collection)**

Fork the demo to experiment with different configurations. The complete example includes:
- Layout switching (table/grid/list)
- Search and filter integration
- Custom cell renderers (status badges, date formatting)
- CroutonItemCardMini for related items
- Avatar groups for attendees
- Client-side filtering with server pagination
::

#### Focused Example: Layout Switching and Filters

This snippet shows the key pattern for combining layout switching with client-side filtering:

```vue
<script setup lang="ts">
const currentLayout = ref<LayoutType>('table')
const searchQuery = ref('')
const statusFilter = ref('all')

const { items: bookings, refresh } = await useCollectionQuery('bookings')

const filteredBookings = computed(() => {
  let result = bookings.value
  if (searchQuery.value) {
    result = result.filter(b => b.name.toLowerCase().includes(searchQuery.value))
  }
  if (statusFilter.value !== 'all') {
    result = result.filter(b => b.status === statusFilter.value)
  }
  return result
})
</script>

<template>
  <CroutonCollection
    :layout="currentLayout"
    collection="bookings"
    :rows="filteredBookings"
    server-pagination
  >
    <template #header>
      <div class="flex items-center justify-between p-4">
        <UInput v-model="searchQuery" placeholder="Search..." />
        <UButtonGroup>
          <UButton
            :variant="currentLayout === 'table' ? 'solid' : 'outline'"
            @click="currentLayout = 'table'"
            icon="i-lucide-table"
          />
          <!-- Grid and list buttons... -->
        </UButtonGroup>
      </div>
    </template>
    <!-- See interactive demo for custom cell renderers -->
  </CroutonCollection>
</template>
```

### Integration with Collection System

CroutonCollection integrates seamlessly with the collection architecture:

```vue
<script setup lang="ts">
// 1. Fetch data with useCollectionQuery
const { items, pending, refresh } = await useCollectionQuery('bookings')

// 2. Get collection configuration
const collections = useCollections()
const config = collections.getConfig('bookings')

// 3. Use configured columns or define custom ones
const columns = config.columns || [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'date', header: 'Date' }
]
</script>

<template>
  <!-- 4. Render with CroutonCollection -->
  <CroutonCollection
    layout="table"
    collection="bookings"
    :columns="columns"
    :rows="items"
    :refresh-fn="refresh"
    create
  />
</template>
```

### Troubleshooting

#### Custom Card Not Showing

If your custom card component isn't being used:

1. **Check file location**: Must be `layers/{layer}/collections/{collection}/app/components/Card.vue`
2. **Check component name**: Must export as `{PascalCaseCollection}Card`
3. **Check layout prop**: Custom cards only work for `list`, `grid`, and `cards` layouts
4. **Check console**: CroutonCollection logs which component it's trying to resolve

#### Responsive Layout Not Working

If responsive layouts aren't switching:

1. **Check Tailwind config**: Ensure breakpoints are configured correctly
2. **Test breakpoints**: Use `useBreakpoints(breakpointsTailwind)` to debug
3. **Verify layout object**: Must follow `ResponsiveLayout` interface
4. **Check base layout**: The `base` property is required for responsive layouts

#### Pagination Not Updating

If pagination doesn't trigger data refresh:

1. **Provide `refreshFn`**: Required for pagination to work
2. **Enable server pagination**: Set `server-pagination` prop to `true`
3. **Provide pagination data**: Must include `currentPage`, `pageSize`, `totalItems`
4. **Check API response**: Ensure it returns proper pagination metadata

---


---

## CroutonItemCardMini

A smart component that fetches and displays a referenced collection item with quick-edit functionality. Supports custom card components via naming convention.

::callout{icon="i-lucide-info" color="blue"}
**Auto-registration**: This component is globally available as `CroutonItemCardMini` and automatically used in table cells for reference fields.
::

::callout{type="info" icon="i-lucide-arrow-right"}
**Data Fetching**: This component uses `useCollectionItem` internally. See the [useCollectionItem API Reference](/api-reference/use-collection-item) for details on caching, reactivity, and error handling.
::

### Props

```typescript
interface ItemCardMiniProps {
  id: string                       // Item ID to fetch and display (required)
  collection: string               // Collection name (required)
}
```

### Props Details

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | *required* | Unique identifier of the item to fetch |
| `collection` | `string` | *required* | Collection name (e.g., 'users', 'locations') |

### Features

#### Dynamic Component Resolution

CroutonItemCardMini uses a plugin architecture to allow collection-specific customization:

**Naming convention:**
```
Collection: "bookingsLocations"
Resolves to: "CroutonBookingsLocationsCardMini"
Expected file: layers/{layer}/collections/bookingsLocations/app/components/CardMini.vue
```

**Resolution flow:**
1. Converts collection name to PascalCase with 'Crouton' prefix
2. Checks Vue component registry for custom component
3. Falls back to default badge display if not found

#### Default Display (Fallback)

When no custom component exists:

- **Badge**: Shows `item.title` in a neutral badge
- **Loading**: Skeleton loader while fetching
- **Error**: Red "Error loading" message
- **Hover interaction**: Edit button appears on hover

#### Data Fetching

- Uses `useCollectionItem()` composable
- Reactive ID parameter (prevents SSR hydration mismatches)
- Auto-refresh when ID changes
- Caching via Nuxt's built-in system

### Basic Usage

**In table cell:**

```vue
<template #location-cell="{ row }">
  <CroutonItemCardMini
    v-if="row.original.location"
    :id="row.original.location"
    collection="bookingsLocations"
  />
</template>
```

**Multiple references (array):**

```vue
<template #tags-cell="{ row }">
  <div v-if="row.original.tags && row.original.tags.length > 0" class="flex flex-wrap gap-1">
    <CroutonItemCardMini
      v-for="itemId in row.original.tags"
      :key="itemId"
      :id="itemId"
      collection="tags"
    />
  </div>
  <span v-else class="text-gray-400">—</span>
</template>
```

**Read-only form field:**

```vue
<template>
  <UFormField label="Location" name="location">
    <CroutonItemCardMini
      v-if="state.location"
      :id="state.location"
      collection="bookingsLocations"
    />
    <span v-else class="text-gray-400 text-sm">Not set</span>
  </UFormField>
</template>
```

### Creating Custom CardMini Components

Create collection-specific card components for richer displays:

**File location:**
```
layers/{layer}/collections/{collection}/app/components/CardMini.vue
```

**Example: UsersCardMini.vue**

```vue
<script setup lang="ts">
interface UserItem {
  title?: string
  name?: string
  avatarUrl?: string
}

interface Props {
  item?: UserItem
  name?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  name: false
})
</script>

<template>
  <div v-if="item" class="w-full flex gap-2">
    <UTooltip
      :text="item.title || item.name"
      :delay-duration="0"
    >
      <UAvatar
        :src="item.avatarUrl || ''"
        :alt="item.title || item.name"
        size="xs"
        class="ring-2 ring-neutral-200 dark:ring-white/10"
      />
    </UTooltip>
    <span v-if="name" class="">{{ item.name }}</span>
  </div>
</template>
```

**Example: LocationCardMini.vue**

```vue
<script setup lang="ts">
interface Props {
  item?: {
    title?: string
    address?: string
    city?: string
  }
}

const props = defineProps<Props>()
</script>

<template>
  <div v-if="item" class="flex items-center gap-2">
    <UIcon name="i-lucide-map-pin" class="text-gray-400" />
    <div>
      <div class="font-medium text-sm">{{ item.title }}</div>
      <div class="text-xs text-gray-500">{{ item.city }}</div>
    </div>
  </div>
</template>
```

### Custom Component Props

Custom CardMini components receive these props automatically:

```typescript
interface CustomCardMiniProps {
  item: any                           // Fetched item data
  pending: Ref<boolean>               // Loading state
  error: Ref<any>                     // Error state
  id: string                          // Item ID
  collection: string                  // Collection name
  refresh: () => Promise<void>        // Refresh function
}
```

### Hover Interactions

The default display includes smooth hover effects:

```vue
<!-- Normal state -->
<UBadge>{{ item.title }}</UBadge>

<!-- Hover state -->
<div class="group">
  <UBadge>{{ item.title }}</UBadge>
  <div class="absolute -top-6 transition-all group-hover:scale-110">
    <UButton
      icon="i-lucide-pencil"
      @click="open('update', collection, [id])"
    />
  </div>
</div>
```

**Transition:**
- Button slides from `-top-1` to `-top-6` on hover
- Button scales to 110%
- 150ms delay, 300ms duration
- Easing: ease-in-out

### Complete Example

Full implementation with custom components and error handling:

```vue
<template>
  <CroutonTable
    collection="bookings"
    :columns="columns"
    :rows="bookings"
  >
    <!-- Single reference -->
    <template #location-cell="{ row }">
      <CroutonItemCardMini
        v-if="row.original.location"
        :id="row.original.location"
        collection="bookingsLocations"
      />
      <span v-else class="text-gray-400 text-sm">No location</span>
    </template>

    <!-- User reference (uses custom UsersCardMini) -->
    <template #assignedTo-cell="{ row }">
      <CroutonItemCardMini
        v-if="row.original.assignedTo"
        :id="row.original.assignedTo"
        collection="users"
      />
    </template>

    <!-- Array of references -->
    <template #tags-cell="{ row }">
      <div class="flex flex-wrap gap-1">
        <CroutonItemCardMini
          v-for="tagId in row.original.tags"
          :key="tagId"
          :id="tagId"
          collection="tags"
        />
      </div>
    </template>
  </CroutonTable>
</template>

<script setup lang="ts">
const { items: bookings } = await useCollectionQuery('bookings')

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'location', header: 'Location' },
  { accessorKey: 'assignedTo', header: 'Assigned To' },
  { accessorKey: 'tags', header: 'Tags' }
]
</script>
```

### Integration with Collection System

**Automatic generation:**

When you define a reference field in your schema:

```json
{
  "location": {
    "type": "string",
    "refTarget": "bookingsLocations",
    "meta": {
      "label": "Location"
    }
  }
}
```

The generator automatically creates table cell slots with CroutonItemCardMini:

```vue
<template #location-cell="{ row }">
  <CroutonItemCardMini
    v-if="row.original.location"
    :id="row.original.location"
    collection="bookingsLocations"
  />
</template>
```

### Composables Used

- **useCollectionItem()** - Fetch individual item by ID
- **useCrouton()** - Open edit modal on button click
- **useNuxtApp()** - Check component registry for custom components

### Troubleshooting

#### Custom CardMini Not Loading

If your custom component isn't being used:

1. **Check file location**: Must be `layers/{layer}/collections/{collection}/app/components/CardMini.vue`
2. **Check component name**: Must match pattern `Crouton{PascalCaseCollection}CardMini`
3. **Check exports**: Component must be properly exported
4. **Check console**: Look for component resolution logs

#### Shows "Error loading"

If the component displays an error:

1. **Check ID**: Verify the item ID exists
2. **Check collection**: Ensure collection name is correct
3. **Check API**: Verify API endpoint returns proper data
4. **Check permissions**: Ensure user has read access

#### Hover Button Not Appearing

If edit button doesn't show on hover:

1. **Check CSS**: Ensure Tailwind classes are compiled
2. **Check parent**: Parent must not have `overflow: hidden`
3. **Check z-index**: Button may be behind other elements

---


---

## CroutonDetailLayout

A view-only layout component for displaying item details with optional edit functionality. New in v1.5.3.

::callout{icon="i-lucide-info" color="blue"}
**New in v1.5.3**: DetailLayout provides a standardized structure for read-only detail pages with built-in loading and error states.
::

### Props

```typescript
interface DetailLayoutProps {
  item?: any                          // Item data to display
  pending?: boolean                   // Loading state (default: false)
  error?: string | null               // Error message (default: null)
  title?: string                      // Header title (default: 'Details')
  subtitle?: string                   // Header subtitle (default: '')
  canEdit?: boolean                   // Show edit button (default: true)
}
```

### Props Details

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `item` | `any` | `null` | The data item to display |
| `pending` | `boolean` | `false` | Shows skeleton loaders when true |
| `error` | `string \| null` | `null` | Error message to display |
| `title` | `string` | `'Details'` | Main heading text |
| `subtitle` | `string` | `''` | Subheading text below title |
| `canEdit` | `boolean` | `true` | Whether to show Edit button |

### Slots

#### `header-title`

Custom title content:

```vue
<template #header-title>
  <h2 class="text-2xl font-bold">{{ item.name }}</h2>
</template>
```

#### `header-subtitle`

Custom subtitle content:

```vue
<template #header-subtitle>
  <p class="text-sm text-gray-600">
    Created {{ formatDate(item.createdAt) }}
  </p>
</template>
```

#### `header-actions`

Custom header action buttons:

```vue
<template #header-actions>
  <div class="flex gap-2">
    <UButton
      icon="i-lucide-share"
      variant="soft"
      @click="handleShare"
    >
      Share
    </UButton>
    <UButton
      icon="i-lucide-pencil"
      color="primary"
      @click="handleEdit"
    >
      Edit
    </UButton>
  </div>
</template>
```

#### `content` (Scoped)

**Main content area** - receives the `item` as a scoped slot prop:

```vue
<template #content="{ item }">
  <div class="space-y-6">
    <div>
      <h3 class="font-semibold mb-2">Description</h3>
      <p class="text-gray-600 dark:text-gray-400">{{ item.description }}</p>
    </div>

    <div>
      <h3 class="font-semibold mb-2">Status</h3>
      <UBadge :color="getStatusColor(item.status)">
        {{ item.status }}
      </UBadge>
    </div>
  </div>
</template>
```

#### `footer` (Scoped)

Optional footer content:

```vue
<template #footer="{ item }">
  <div class="text-xs text-gray-500">
    Last updated: {{ formatDate(item.updatedAt) }} by {{ item.updatedBy }}
  </div>
</template>
```

### Events

```typescript
@edit="handleEdit"  // Emitted when default Edit button clicked
```

### Basic Usage

**Standalone detail page with basic setup:**

```vue
<template>
  <CroutonDetailLayout
    :item="booking"
    :pending="pending"
    :error="error"
    :title="booking?.name || 'Booking Details'"
    @edit="handleEdit"
  >
    <template #content="{ item }">
      <div class="space-y-6">
        <div>
          <h3 class="font-semibold text-sm text-gray-500 mb-1">Location</h3>
          <CroutonItemCardMini
            :id="item.location"
            collection="locations"
          />
        </div>

        <div>
          <h3 class="font-semibold text-sm text-gray-500 mb-1">Date & Time</h3>
          <CroutonDate :date="item.date" format="long" />
        </div>
      </div>
    </template>
  </CroutonDetailLayout>
</template>

<script setup lang="ts">
const route = useRoute()
const { open } = useCrouton()

const { item: booking, pending, error } = await useCollectionItem(
  'bookings',
  computed(() => route.params.id as string)
)

const handleEdit = () => {
  open('update', 'bookings', [booking.value?.id])
}
</script>
```

**With custom formatting and status badges:**

```vue
<template>
  <CroutonDetailLayout
    :title="booking?.name"
    :subtitle="`Created ${formatDate(booking?.createdAt)}`"
  >
    <template #content="{ item }">
      <div>
        <h3 class="font-semibold text-sm text-gray-500 mb-1">Status</h3>
        <UBadge :color="getStatusColor(item.status)">
          {{ item.status }}
        </UBadge>
      </div>
    </template>
  </CroutonDetailLayout>
</template>

<script setup lang="ts">
const getStatusColor = (status: string) => {
  const colors = {
    confirmed: 'green',
    pending: 'yellow',
    cancelled: 'red'
  }
  return colors[status] || 'gray'
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}
</script>
```

### Loading States

Automatic skeleton loaders when `pending={true}`:

```vue
<template>
  <CroutonDetailLayout
    :item="item"
    :pending="pending"
    :error="error"
    title="User Details"
  >
    <!-- Content slot -->
  </CroutonDetailLayout>
</template>
```

**Loading display:**
- Title skeleton (w-48)
- Two subtitle skeletons (w-32, w-24)
- Large content skeleton (h-96)

### Error States

Displays error panel when `error` prop is provided:

```vue
<template>
  <CroutonDetailLayout
    :item="item"
    :pending="false"
    :error="errorMessage"
  >
    <!-- Content slot -->
  </CroutonDetailLayout>
</template>

<script setup lang="ts">
const errorMessage = ref<string | null>(null)

try {
  // Fetch item
} catch (err) {
  errorMessage.value = err.message
}
</script>
```

**Error display:**
- Alert icon (`i-lucide-octagon-alert`)
- Error message in red panel
- Dark mode support

### Convention-Based Loading

DetailLayout integrates with FormDynamicLoader's naming convention:

**Pattern:**
```
Form component: "BookingsForm.vue"
Detail component: "BookingsDetail.vue"
```

**FormDynamicLoader resolution** (when `action='view'`):
1. Looks for `BookingsDetail.vue`
2. Falls back to `BookingsForm.vue` if not found
3. Passes `activeItem` and view-specific props

**Example Detail component:**

```vue
<!-- layers/bookings/collections/bookings/app/components/Detail.vue -->
<template>
  <CroutonDetailLayout
    :item="activeItem"
    :title="activeItem?.name || 'Booking Details'"
    @edit="handleEdit"
  >
    <template #content="{ item }">
      <!-- Custom detail view -->
    </template>
  </CroutonDetailLayout>
</template>

<script setup lang="ts">
// Receives props from FormDynamicLoader
const props = defineProps<{
  activeItem: any
  loading: string
  action: 'view' | 'create' | 'update'
  items: any[]
  collection: string
}>()

const { open } = useCrouton()

const handleEdit = () => {
  open('update', props.collection, [props.activeItem.id])
}
</script>
```

### View → Edit Workflow

Complete flow from view to edit mode:

```vue
<template>
  <!-- View button in table -->
  <CroutonItemButtonsMini
    :view="true"
    :update="true"
    @view="handleView(item)"
    @update="handleUpdate(item)"
  />
</template>

<script setup lang="ts">
const { open } = useCrouton()

// 1. User clicks eye icon
const handleView = (item: any) => {
  open('view', 'bookings', [item.id])
  // Opens DetailLayout in slideover
}

// 2. User clicks Edit button in DetailLayout
// DetailLayout emits @edit event

// 3. Transition to Form component
const handleUpdate = (item: any) => {
  open('update', 'bookings', [item.id])
  // Opens Form in slideover for editing
}
</script>
```

### Complete Example

For a complete working example showing a full-featured detail page with custom header actions, multiple content sections, related item displays, and metadata footer, see this interactive demo:

::callout{type="info" icon="i-lucide-code"}
**[View Full Interactive Demo →](https://stackblitz.com/edit/nuxt-crouton-job-detail)**

Fork the demo to explore all CroutonDetailLayout customizations. The complete example includes:
- Custom header actions (Refresh, Edit, Delete)
- Multiple content sections (Basic Info, Description, Status, Related Items)
- Related item display with CroutonItemCardMini
- Status badges and progress indicators
- Footer metadata display
- Permission-based editing
::

#### Focused Example: Custom Header Actions

This snippet shows the key pattern for adding custom action buttons to the detail page header:

```vue
<script setup lang="ts">
const route = useRoute()
const { open } = useCrouton()

const { item: job, pending, refresh } = await useCollectionItem(
  'discubotJobs',
  computed(() => route.params.id as string)
)

const canEdit = computed(() => job.value?.status !== 'completed')

const handleEdit = () => {
  open('update', 'discubotJobs', [job.value?.id])
}
</script>

<template>
  <CroutonDetailLayout
    :item="job"
    :pending="pending"
    :title="job?.name || 'Job Details'"
    :subtitle="`Status: ${job?.status}`"
    :can-edit="canEdit"
    @edit="handleEdit"
  >
    <template #header-actions>
      <div class="flex gap-2">
        <UButton icon="i-lucide-refresh-cw" variant="soft" @click="refresh">
          Refresh
        </UButton>
        <UButton icon="i-lucide-pencil" color="primary" @click="handleEdit">
          Edit
        </UButton>
      </div>
    </template>

    <!-- See interactive demo for complete content sections -->
  </CroutonDetailLayout>
</template>
```

### Layout Structure

DetailLayout provides a three-section layout:

```
┌──────────────────────────────────────┐
│ Header (sticky)                      │
│  - Title                             │
│  - Subtitle                          │
│  - Actions (Edit button)             │
├──────────────────────────────────────┤
│                                      │
│ Content (scrollable)                 │
│                                      │
│  <Your custom content here>          │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ Footer (optional)                    │
│  - Metadata, timestamps, etc.        │
└──────────────────────────────────────┘
```

**CSS:**
- Full height flex container
- Sticky header with border
- Scrollable content area
- Optional footer (only renders if slot used)

### Troubleshooting

#### Skeleton Loaders Wrong Size

If skeleton doesn't match content:

1. **Customize skeletons**: Override loading state with custom slot
2. **Use pending prop**: Ensure `pending` is reactive and updates properly
3. **Provide skeleton slot**: Create custom loading template

#### Edit Button Not Working

If edit button doesn't open form:

1. **Check @edit handler**: Must call `useCrouton().open()`
2. **Check canEdit prop**: May be set to `false`
3. **Check permissions**: User may not have edit access

#### Content Not Scrolling

If content area doesn't scroll:

1. **Check parent container**: Must not have fixed height
2. **Check CSS**: Ensure no `overflow: hidden` on parents
3. **Check content height**: Content must exceed viewport

---

# Form System Components

Nuxt Crouton provides a sophisticated form system that handles CRUD operations with multiple container types, dynamic component loading, validation, and complex field types.

::callout{icon="i-lucide-info" color="blue"}
**Form Architecture**: Forms in Nuxt Crouton are managed globally via `useCrouton()` and rendered automatically in modals, slideovers, or dialogs. You don't manually place Form components in your templates.
::


---

## CroutonCollection

Display collection items in table or list layouts. Grid and cards layouts are planned for future releases.

### Props

```typescript
interface CroutonCollectionProps {
  rows: any[]                    // Array of items to display
  columns: Column[]              // Column definitions
  loading?: boolean              // Loading state
  layout?: 'table' | 'grid' | 'list' | 'kanban'  // Display layout
  collection?: string            // Collection name (for actions)
  selectable?: boolean           // Enable row selection
  selected?: string[]            // Selected row IDs (v-model)
}
```

### Column Definition

```typescript
interface Column {
  key: string                    // Property key or unique identifier
  label: string                  // Display label
  sortable?: boolean             // Enable sorting
  render?: (row: any) => string  // Custom render function
  component?: string             // Custom component name
}
```

### Basic Usage

```vue
<template>
  <CroutonCollection
    :rows="items"
    :columns="columns"
    :loading="pending"
    layout="table"
    collection="shopProducts"
  />
</template>

<script setup lang="ts">
const { items, pending } = await useCollectionQuery('shopProducts')

const columns = [
  { key: 'name', label: 'Product Name', sortable: true },
  { key: 'price', label: 'Price', sortable: true },
  { key: 'inStock', label: 'In Stock' }
]
</script>
```


---

## Available Layouts

### ✅ Table Layout

The table layout is ideal for data-dense views with full sorting, filtering, and pagination support:

```vue
<template>
  <CroutonCollection
    :rows="products"
    :columns="columns"
    layout="table"
  />
</template>
```

### ✅ List Layout

List layout optimized for mobile devices with automatic field detection and avatar support.

**Automatic Field Mapping:**

The list layout intelligently detects common fields in your data without configuration:

- **Title fields** (priority order): `name`, `title`, `label`, `email`, `username`, `id`
- **Subtitle fields**: `description`, `email`, `username`, `role`, `createdAt`
- **Avatar fields**: `avatar`, `image`, `avatarUrl`, `profileImage`

```vue
<script setup lang="ts">
// Data with standard field names - works automatically!
const users = [
  {
    id: 1,
    name: 'John Doe',              // → Title
    email: 'john@example.com',     // → Subtitle
    avatar: { src: '/john.jpg' }   // → Avatar image
  }
]
</script>

<template>
  <!-- Zero configuration needed -->
  <CroutonCollection
    :rows="users"
    layout="list"
  />
</template>
```

For detailed information about list layout features and customization, see the [List Layout Guide](/customization/layouts).

### 🚧 Grid Layout (Coming Soon)

Grid layout for image-heavy content is planned for a future release.

### 🚧 Cards Layout (Coming Soon)

Card-based layout for rich content is planned for a future release.

### Custom Render Functions

Add computed columns with custom rendering:

```vue
<script setup lang="ts">
const columns = [
  { key: 'name', label: 'Name' },
  { key: 'price', label: 'Price' },
  {
    key: 'status',
    label: 'Status',
    render: (row) => row.inStock ? 'Available' : 'Out of Stock'
  },
  {
    key: 'profit',
    label: 'Profit',
    render: (row) => `$${(row.price - row.cost).toFixed(2)}`
  }
]
</script>
```

### Custom Components

Use custom components for specific columns:

```vue
<script setup lang="ts">
const columns = [
  { key: 'name', label: 'Product' },
  { key: 'price', label: 'Price' },
  {
    key: 'actions',
    label: '',
    component: 'ProductActions'  // Your custom component
  }
]
</script>
```

### Selectable Rows

Enable row selection for bulk operations:

```vue
<template>
  <div>
    <CroutonCollection
      v-model:selected="selectedIds"
      :rows="products"
      :columns="columns"
      selectable
    />

    <UButton
      v-if="selectedIds.length > 0"
      @click="handleBulkAction"
    >
      Process {{ selectedIds.length }} items
    </UButton>
  </div>
</template>

<script setup lang="ts">
const selectedIds = ref<string[]>([])

const handleBulkAction = async () => {
  // Perform bulk operation
  console.log('Selected:', selectedIds.value)
}
</script>
```

### With Related Data

Display related data using render functions:

```vue
<script setup lang="ts">
const { items: products } = await useCollectionQuery('shopProducts')
const { items: categories } = await useCollectionQuery('shopCategories')

// Map categories by ID for quick lookup
const categoryMap = computed(() =>
  Object.fromEntries(categories.value.map(c => [c.id, c]))
)

const columns = [
  { key: 'name', label: 'Product' },
  { key: 'price', label: 'Price' },
  {
    key: 'category',
    label: 'Category',
    render: (row) => categoryMap.value[row.categoryId]?.name || 'N/A'
  }
]
</script>

<template>
  <CroutonCollection :rows="products" :columns="columns" />
</template>
```

---


---

## CardMini

Display a referenced item with its title and a quick-edit button. Used in table cells to show relationships.

### Props

```typescript
interface CardMiniProps {
  id: string                       // ID of the referenced item
  collection: string               // Collection name
}
```

### Basic Usage

Automatically generated in List views for reference fields:

```vue
<template #authorId-cell="{ row }">
  <CardMini
    v-if="row.original.authorId"
    :id="row.original.authorId"
    collection="authors"
  />
</template>
```

### Features

- **Item preview** - Shows referenced item's title
- **Quick edit** - Hover reveals edit button
- **Loading state** - Skeleton while fetching item
- **Null handling** - Gracefully handles missing references

### In List Component

The generator automatically creates CardMini slots for reference fields:

```vue
<template>
  <CroutonCollection
    :rows="posts"
    :columns="columns"
    collection="blogPosts"
  >
    <!-- Auto-generated for refTarget fields -->
    <template #authorId-cell="{ row }">
      <CardMini
        v-if="row.original.authorId"
        :id="row.original.authorId"
        collection="authors"
      />
    </template>

    <template #categoryId-cell="{ row }">
      <CardMini
        v-if="row.original.categoryId"
        :id="row.original.categoryId"
        collection="categories"
      />
    </template>
  </CroutonCollection>
</template>
```

### Visual Design

```
┌─────────────────────────────────┐
│  John Doe                    ✏️ │  ← Hover state
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  John Doe                       │  ← Normal state
└─────────────────────────────────┘

┌─────────────────────────────────┐
│  ▬▬▬▬▬▬▬▬                       │  ← Loading state
└─────────────────────────────────┘
```

### Customization

Override the display field by modifying the component:

```vue
<!-- Custom CardMini wrapper -->
<template #authorId-cell="{ row }">
  <CardMini
    v-if="row.original.authorId"
    :id="row.original.authorId"
    collection="authors"
  >
    <template #default="{ item }">
      {{ item.firstName }} {{ item.lastName }}
    </template>
  </CardMini>
</template>
```

---


---

## CroutonDependentFieldCardMini

Displays dependent field values by resolving ID references to full objects from a parent item's JSON array field.

::callout{icon="i-lucide-lightbulb" color="amber"}
**Use Case**: When you have a field that references options stored in another item. For example, a booking that references time slots stored in a location object.
::

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string \| string[] \| null` | *required* | ID(s) of selected option(s) |
| `dependentValue` | `string` | *required* | Parent item ID (e.g., `locationId`) |
| `dependentCollection` | `string` | *required* | Parent collection name |
| `dependentField` | `string` | *required* | Field in parent containing options array |

### Features

- **Automatic Resolution**: Fetches parent item and resolves IDs to full objects
- **Custom Component Support**: Looks for custom card components for rich display
- **Fallback Rendering**: Uses badges if no custom component exists
- **Loading & Error States**: Built-in skeleton and error handling
- **Automatic Caching**: Uses `useCollectionItem` for efficient data fetching

### Usage

#### Basic Example

```vue
<template>
  <CroutonDependentFieldCardMini
    :value="booking.slotIds"
    :dependent-value="booking.locationId"
    dependent-collection="locations"
    dependent-field="slots"
  />
</template>
```

This will:
1. Fetch the location item using `booking.locationId`
2. Get the `slots` array from the location
3. Resolve `booking.slotIds` to full slot objects
4. Display them using custom component or badges

#### With Custom Card Component

Create a custom card component for rich display:

```vue
<!-- components/LocationsSlotCardMini.vue -->
<template>
  <div class="flex flex-wrap gap-2">
    <UBadge
      v-for="slot in value"
      :key="slot.id"
      :color="slot.available ? 'success' : 'neutral'"
      variant="soft"
      size="lg"
    >
      <UIcon :name="slot.icon" class="mr-1" />
      {{ slot.label }}
      <span class="text-xs ml-1">{{ slot.time }}</span>
    </UBadge>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: Array<{ id: string; label: string; time: string; icon: string; available: boolean }>
}>()
</script>
```

### Component Naming Convention

The component looks for custom cards using this pattern:

```
{Collection}{Field}CardMini
```

Examples:
- `dependentCollection: "locations"`, `dependentField: "slots"` → `LocationsSlotCardMini`
- `dependentCollection: "events"`, `dependentField: "categories"` → `EventsCategoryCardMini`

::callout{icon="i-lucide-info" color="blue"}
**Singularization**: The field name is automatically singularized (e.g., "slots" → "slot")
::

### States

| State | Display |
|-------|---------|
| Loading | Skeleton placeholder |
| Error | "Error loading" in red |
| Empty | Em dash (—) |
| Success | Custom component or badge list |

### Data Structure Example

```typescript
// Location object structure
{
  id: "loc-1",
  name: "Downtown Studio",
  slots: [
    { id: "slot-1", label: "Morning", time: "9:00 AM", icon: "i-lucide-sun" },
    { id: "slot-2", label: "Afternoon", time: "2:00 PM", icon: "i-lucide-sunset" },
    { id: "slot-3", label: "Evening", time: "7:00 PM", icon: "i-lucide-moon" }
  ]
}

// Booking object structure
{
  id: "book-1",
  locationId: "loc-1",
  slotIds: ["slot-1", "slot-3"]  // References to slots
}
```

---


---

## CroutonItemButtonsMini

Compact action buttons for view, edit, and delete operations on individual items.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `view` | `boolean` | `false` | Show view button |
| `delete` | `boolean` | `false` | Show delete button |
| `update` | `boolean` | `false` | Show update/edit button |
| `buttonClasses` | `string` | `''` | Additional classes for buttons |
| `containerClasses` | `string` | `'flex flex-row gap-2'` | Container wrapper classes |
| `viewTooltip` | `string` | `''` | Tooltip text for view button |
| `updateTooltip` | `string` | `''` | Tooltip text for update button |
| `deleteTooltip` | `string` | `''` | Tooltip text for delete button |
| `viewLoading` | `boolean` | `false` | Loading state for view button |
| `updateLoading` | `boolean` | `false` | Loading state for update button |
| `deleteLoading` | `boolean` | `false` | Loading state for delete button |

### Events

| Event | Description |
|-------|-------------|
| `view` | Emitted when view button is clicked |
| `update` | Emitted when update button is clicked |
| `delete` | Emitted when delete button is clicked |

### Features

- **Conditional Display**: Only shows buttons you enable via props
- **Loading States**: Individual loading states for each button
- **Tooltips**: Optional tooltips for each action
- **Consistent Styling**: Pre-configured colors and icons
- **Compact Size**: Uses `xs` size for tight spaces

### Usage

#### Basic Usage

```vue
<template>
  <CroutonItemButtonsMini
    view
    update
    delete
    @view="handleView"
    @update="handleUpdate"
    @delete="handleDelete"
  />
</template>

<script setup lang="ts">
const handleView = () => {
  console.log('View clicked')
}

const handleUpdate = () => {
  console.log('Update clicked')
}

const handleDelete = () => {
  console.log('Delete clicked')
}
</script>
```

#### With Tooltips and Loading

```vue
<template>
  <CroutonItemButtonsMini
    view
    update
    delete
    view-tooltip="Preview item"
    update-tooltip="Edit details"
    delete-tooltip="Remove item"
    :update-loading="isSaving"
    :delete-loading="isDeleting"
    @view="openPreview"
    @update="openEditor"
    @delete="confirmDelete"
  />
</template>

<script setup lang="ts">
const isSaving = ref(false)
const isDeleting = ref(false)

const openPreview = () => {
  // Open preview modal
}

const openEditor = async () => {
  isSaving.value = true
  // Open editor
  isSaving.value = false
}

const confirmDelete = async () => {
  isDeleting.value = true
  // Perform deletion
  isDeleting.value = false
}
</script>
```

#### In a Table Cell

```vue
<template>
  <CroutonTable :rows="products" :columns="columns">
    <template #actions-cell="{ row }">
      <CroutonItemButtonsMini
        view
        update
        delete
        @view="viewProduct(row.id)"
        @update="editProduct(row.id)"
        @delete="deleteProduct(row.id)"
      />
    </template>
  </CroutonTable>
</template>
```

#### Custom Styling

```vue
<template>
  <CroutonItemButtonsMini
    update
    delete
    button-classes="rounded-full"
    container-classes="flex flex-col gap-1"
    @update="handleUpdate"
    @delete="handleDelete"
  />
</template>
```

### Button Styling

Each button has pre-configured styling:

| Button | Icon | Color | Variant |
|--------|------|-------|---------|
| View | `i-lucide-eye` | neutral | soft |
| Update | `i-ph-pencil` | primary | soft |
| Delete | `i-ph-trash-duotone` | error | soft |

### Conditional Rendering Example

```vue
<template>
  <CroutonItemButtonsMini
    :view="hasViewPermission"
    :update="hasUpdatePermission"
    :delete="hasDeletePermission"
    @view="handleView"
    @update="handleUpdate"
    @delete="handleDelete"
  />
</template>

<script setup lang="ts">
const { user } = useAuth()

const hasViewPermission = computed(() => user.value?.role !== 'guest')
const hasUpdatePermission = computed(() => ['admin', 'editor'].includes(user.value?.role))
const hasDeletePermission = computed(() => user.value?.role === 'admin')
</script>
```

---


---

## CroutonUsersCardMini

Compact user card with avatar and optional name display.

### Props

```typescript
interface UserItem {
  title?: string
  name?: string
  avatarUrl?: string
}

interface Props {
  item?: UserItem
  name?: boolean  // Show name text beside avatar
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `item` | `UserItem` | - | User object with title/name/avatarUrl |
| `name` | `boolean` | `false` | Display name text beside avatar |

### Features

- **Tooltip**: Hover shows user's title or name
- **Avatar**: UAvatar with fallback to initials
- **Responsive**: Compact size perfect for tables/lists
- **Ring Border**: Styled with ring border
- **Name Display**: Optional name text beside avatar
- **Null Safe**: Gracefully handles missing user data

### Usage

#### Basic Usage (Avatar Only)

```vue
<template>
  <CroutonUsersCardMini :item="user" />
</template>

<script setup lang="ts">
const user = ref({
  title: 'John Doe',
  name: 'John Doe',
  avatarUrl: 'https://example.com/avatar.jpg'
})
</script>
```

#### With Name Display

```vue
<template>
  <CroutonUsersCardMini :item="user" name />
  <!-- Shows: [Avatar] John Doe -->
</template>

<script setup lang="ts">
const user = ref({
  title: 'Jane Smith',
  name: 'Jane Smith',
  avatarUrl: 'https://example.com/jane.jpg'
})
</script>
```

#### In Table Cell

```vue
<template>
  <CroutonTable :rows="tasks" :columns="columns">
    <template #assignee-cell="{ row }">
      <CroutonUsersCardMini :item="row.assignee" />
    </template>
  </CroutonTable>
</template>

<script setup lang="ts">
const tasks = ref([
  {
    id: '1',
    title: 'Fix bug',
    assignee: {
      title: 'John Doe',
      avatarUrl: 'https://...'
    }
  }
])
</script>
```

#### Multiple Users in Row

```vue
<template>
  <div class="flex -space-x-2">
    <CroutonUsersCardMini
      v-for="user in teamMembers"
      :key="user.id"
      :item="user"
    />
  </div>
</template>

<script setup lang="ts">
const teamMembers = ref([
  { title: 'Alice', avatarUrl: '...' },
  { title: 'Bob', avatarUrl: '...' },
  { title: 'Carol', avatarUrl: '...' }
])
</script>
```

#### With Missing Avatar

```vue
<template>
  <CroutonUsersCardMini :item="userWithoutAvatar" name />
  <!-- Shows initials instead of image -->
</template>

<script setup lang="ts">
const userWithoutAvatar = ref({
  title: 'John Doe',
  name: 'John Doe',
  avatarUrl: '' // Empty - UAvatar shows initials "JD"
})
</script>
```

#### List of Users

```vue
<template>
  <div class="space-y-2">
    <div
      v-for="member in members"
      :key="member.id"
      class="flex items-center gap-2"
    >
      <CroutonUsersCardMini :item="member" name />
      <span class="text-sm text-gray-500">{{ member.role }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const members = ref([
  { id: '1', name: 'Alice', title: 'Alice', avatarUrl: '...', role: 'Admin' },
  { id: '2', name: 'Bob', title: 'Bob', avatarUrl: '...', role: 'Editor' }
])
</script>
```

### Avatar Styling

- Size: `xs` (smallest size)
- Ring: `ring-2 ring-neutral-200 dark:ring-white/10`
- Tooltip delay: `0ms` (instant)
- Tooltip position: Top center with arrow

### Tooltip Content

Shows `item.title` or `item.name` (in that order):
```vue
<!-- If both exist, title is used -->
<UTooltip :text="item.title || item.name">
  <UAvatar ... />
</UTooltip>
```

### Null/Empty Handling

```vue
<template>
  <CroutonUsersCardMini :item="undefined" />
  <!-- Renders nothing (v-if="item") -->
</template>
```

::callout{icon="i-lucide-info" color="blue"}
**User Object**: The component expects `title` OR `name` field. If both are missing, the tooltip will be empty but the avatar will still show.
::

---


## Related Resources

- [Data Composables](/api-reference/composables/data-composables) - Data fetching for layouts
- [Nuxt UI Card](https://ui.nuxt.com/components/card) - Base card component
- [Layout Patterns](/customization/layouts) - Layout customization
