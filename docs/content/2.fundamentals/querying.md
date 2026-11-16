---
title: Querying Data
description: Fetching and displaying data in Nuxt Crouton
icon: i-lucide-search
---

The `useCollectionQuery` composable is the primary way to fetch data in Nuxt Crouton. This guide covers the most common querying patterns.

::callout{type="info" icon="i-lucide-info"}
**API Reference**: For complete API details, see [useCollectionQuery composable](/api-reference/composables).
::

## Core Patterns

These five patterns cover 95% of real-world use cases.

### 1. Basic Query

Fetch all items from a collection with error and loading state handling.

```vue
<script setup lang="ts">
// Returns typed items array plus loading/error states
const { items, pending, error, refresh } = await useCollectionQuery('shopProducts')
</script>

<template>
  <div v-if="pending">Loading...</div>
  <div v-else-if="error">Error: {{ error }}</div>
  <div v-else>
    <div v-for="product in items" :key="product.id">
      {{ product.name }} - ${{ product.price }}
    </div>
  </div>
</template>
```

::callout{type="tip"}
**Return Values**: `items` (typed array), `pending` (loading state), `error` (error object), `refresh` (manual refetch function), `data` (raw response). See [Return Values](#return-values) below.
::

### 2. With Filters and Search

Reactive filtering with search and category selection - the most common real-world pattern.

```vue
<script setup lang="ts">
const searchQuery = ref('')
const category = ref<string | null>(null)

// Query automatically re-runs when reactive params change
const { items, pending } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    search: searchQuery.value,
    category: category.value
  }))
})
</script>

<template>
  <div>
    <UInput v-model="searchQuery" placeholder="Search products..." />
    <USelectMenu v-model="category" :options="categories" />
    <CroutonCollection :rows="items" :loading="pending" />
  </div>
</template>
```

::callout{type="tip"}
**Auto-Refetch**: Queries wrapped in `computed()` automatically re-fetch when reactive values change. No manual `watch()` needed! Learn more about [Vue reactivity fundamentals](https://vuejs.org/guide/essentials/reactivity-fundamentals.html).
::

### 3. With Pagination

Page-based queries for handling large datasets efficiently.

```vue
<script setup lang="ts">
const page = ref(1)
const limit = ref(10)

const { items, pending } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    page: page.value,
    limit: limit.value
  }))
})

const nextPage = () => page.value++
const prevPage = () => page.value--
</script>

<template>
  <div>
    <CroutonCollection :rows="items" :loading="pending" />

    <div class="flex gap-2">
      <UButton @click="prevPage" :disabled="page === 1">
        Previous
      </UButton>
      <span>Page {{ page }}</span>
      <UButton @click="nextPage">
        Next
      </UButton>
    </div>
  </div>
</template>
```

::callout{type="warning"}
**API Setup Required**: Generated API endpoints use client-side pagination by default (all data fetched, paginated in browser). For server-side pagination with large datasets, you need to modify the generated files. See the complete [Pagination Guide](/guides/pagination) for step-by-step instructions.
::

### 4. With Sorting

Sort controls with ascending/descending order.

```vue
<script setup lang="ts">
const sortBy = ref('name')
const sortOrder = ref<'asc' | 'desc'>('asc')

const { items } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    sortBy: sortBy.value,
    sortOrder: sortOrder.value
  }))
})

const toggleSort = () => {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}
</script>

<template>
  <div class="flex gap-2 items-center">
    <USelectMenu
      v-model="sortBy"
      :options="['name', 'price', 'createdAt']"
      placeholder="Sort by..."
    />
    <UButton @click="toggleSort" icon="i-lucide-arrow-up-down">
      {{ sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending' }}
    </UButton>
  </div>

  <CroutonCollection :rows="items" />
</template>
```

### 5. With Relations (Fetch Separately)

Display related data by fetching collections separately and mapping them client-side.

```vue
<script setup lang="ts">
// Fetch both collections
const { items: products } = await useCollectionQuery('shopProducts')
const { items: categories } = await useCollectionQuery('shopCategories')

// Create lookup map for quick access
const categoryMap = computed(() =>
  Object.fromEntries(categories.value.map(c => [c.id, c]))
)

// Define columns with relation lookup
const columns = [
  { key: 'name', label: 'Product' },
  { key: 'price', label: 'Price' },
  {
    key: 'category',
    label: 'Category',
    // Look up category name from related collection
    render: (row) => categoryMap.value[row.categoryId]?.name || 'N/A'
  }
]
</script>

<template>
  <CroutonTable :rows="products" :columns="columns" />
</template>
```

::callout{type="info"}
**Relations Pattern**: Nuxt Crouton fetches collections separately (not joins). This approach is simpler, more cacheable, and works well with edge caching. For complex joins, use [Drizzle queries](/patterns/drizzle).
::

---

## Additional Patterns

These patterns handle specific use cases beyond the core five.

### Client-Side Filtering

For simple filtering without server round-trips (useful for small datasets):

```vue
<script setup lang="ts">
const { items, pending } = await useCollectionQuery('shopProducts')

const searchQuery = ref('')
const filteredProducts = computed(() =>
  items.value.filter(p =>
    p.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
)
</script>

<template>
  <UInput v-model="searchQuery" placeholder="Search..." />
  <CroutonCollection :rows="filteredProducts" :loading="pending" />
</template>
```

::callout{type="info"}
**Computed Properties**: Learn more about Vue's `computed()` for derived state in the [Vue documentation](https://vuejs.org/guide/essentials/computed.html).
::

### Loading States

Comprehensive loading, error, and empty state handling:

```vue
<script setup lang="ts">
const { items, pending, error } = await useCollectionQuery('shopProducts')
</script>

<template>
  <div>
    <div v-if="pending" class="flex justify-center p-8">
      <USkeleton class="h-32 w-full" />
    </div>
    <div v-else-if="error" class="text-red-500">
      Failed to load: {{ error }}
    </div>
    <div v-else-if="items.length === 0" class="text-center p-8">
      No products found
    </div>
    <CroutonCollection v-else :rows="items" />
  </div>
</template>
```

### Manual Refetch

Trigger a manual data refresh:

```vue
<script setup lang="ts">
const { items, refresh } = await useCollectionQuery('shopProducts')

const handleRefresh = async () => {
  await refresh()
}
</script>

<template>
  <UButton @click="handleRefresh">Refresh Data</UButton>
</template>
```

### Dependent Queries

Fetch data based on another query's results:

```vue
<script setup lang="ts">
const { items: categories } = await useCollectionQuery('shopCategories')
const selectedCategory = ref<string | null>(null)

// Auto-refetches when selectedCategory changes
const { items: subcategories } = await useCollectionQuery('shopSubcategories', {
  query: computed(() => ({
    categoryId: selectedCategory.value
  }))
})
</script>
```

### With Translations (i18n)

Integrate with `@nuxtjs/i18n` for locale-aware queries:

```vue
<script setup lang="ts">
const { locale } = useI18n()

const { items } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({
    locale: locale.value
  }))
})
// Auto-refetches when locale changes!
</script>
```

::callout{type="info"}
**i18n Integration**: Learn more in the [Internationalization feature guide](/features/internationalization).
::

### Disable Auto-Watch

By default, queries auto-watch computed params. To disable:

```vue
<script setup lang="ts">
const page = ref(1)

const { items, refresh } = await useCollectionQuery('shopProducts', {
  query: computed(() => ({ page: page.value })),
  watch: false  // Disable auto-watch
})

// Manually trigger refresh when needed
watch(page, () => refresh())
</script>
```

::callout{type="info"}
**Vue Watchers**: Learn more about Vue's `watch()` API in the [Vue documentation](https://vuejs.org/api/reactivity-core.html#watch).
::

## Return Values

`useCollectionQuery` returns:

```typescript
{
  items: ComputedRef<T[]>    // Typed array of collection items
  data: Ref<any>              // Raw response data
  pending: Ref<boolean>       // Loading state
  error: Ref<any>            // Error object if request failed
  refresh: () => Promise<void> // Manual refresh function
}
```

## Related Topics

- [Pagination Guide](/guides/pagination) - Adding server-side pagination to generated collections
- [Data Operations](/fundamentals/data-operations)
- [Caching](/fundamentals/caching)
- [Working with Relations](/patterns/relations)
