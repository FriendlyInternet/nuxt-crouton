<script setup lang="ts">
/**
 * Collection Block Public Renderer
 *
 * Renders an embedded collection in read-only mode using CroutonCollection.
 * Uses stateless mode to provide clean public view without admin actions.
 * Supports table, list, grid, and cards layouts.
 *
 * NOTE: This component must NOT use top-level await (no async setup).
 * It is rendered via dynamic <component :is> inside BlockContent.vue
 * which has no <Suspense> boundary. Using await would cause the
 * component to silently fail to render.
 */
import type { CollectionBlockAttrs } from '../../../types/blocks'

interface Props {
  attrs: CollectionBlockAttrs
}

const props = defineProps<Props>()
const { t } = useT()

// Get collection config to verify it exists
const { getConfig } = useCollections()
const collectionConfig = computed(() => {
  if (!props.attrs.collection) return null
  return getConfig(props.attrs.collection)
})

// Parse pageSize to number (it comes as string from select)
const pageSize = computed(() => {
  const size = props.attrs.pageSize
  if (typeof size === 'number') return size
  if (typeof size === 'string') return parseInt(size, 10)
  return 10
})

// Map layout value
const layout = computed(() => props.attrs.layout || 'table')

// Reactive collection data - fetches when collection name changes
const items = ref<any[]>([])
const pending = ref(false)
const fetchError = ref<any>(null)

// Watch collection name and re-fetch when it changes
watch(
  () => props.attrs.collection,
  async (collectionName) => {
    if (!collectionName) {
      items.value = []
      pending.value = false
      return
    }

    pending.value = true
    fetchError.value = null

    try {
      const result = await useCollectionQuery(collectionName, {
        query: computed(() => ({
          pageSize: pageSize.value,
          sortBy: 'createdAt',
          sortDirection: 'desc'
        }))
      })
      items.value = result.items.value || []

      // Keep items in sync with future reactive updates from the query
      watch(result.items, (newItems) => {
        items.value = newItems || []
      })
    } catch (e) {
      console.error('[CollectionBlock] Failed to fetch collection:', e)
      fetchError.value = e
      items.value = []
    } finally {
      pending.value = false
    }
  },
  { immediate: true }
)

// Generate basic columns from data (if available) for table layout
// This provides a fallback when no explicit columns are configured
const autoColumns = computed(() => {
  if (!items.value?.length) return []

  const firstItem = items.value[0]
  const skipFields = ['id', 'teamId', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']

  return Object.keys(firstItem)
    .filter(key => !skipFields.includes(key) && !key.endsWith('User'))
    .slice(0, 5) // Limit to first 5 fields for cleaner display
    .map(key => ({
      accessorKey: key,
      header: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')
    }))
})
</script>

<template>
  <div class="collection-block">
    <!-- Title if set -->
    <h2
      v-if="attrs.title"
      class="text-2xl font-bold mb-4"
    >
      {{ attrs.title }}
    </h2>

    <!-- Error: No collection selected -->
    <div
      v-if="!attrs.collection"
      class="p-8 text-center text-muted bg-gray-50 dark:bg-gray-800/50 rounded-lg"
    >
      <UIcon name="i-lucide-alert-circle" class="size-8 mb-2 mx-auto" />
      <p>{{ t('pages.blocks.collection.noCollectionSelected') }}</p>
    </div>

    <!-- Error: Collection not found -->
    <div
      v-else-if="!collectionConfig"
      class="p-8 text-center text-warning bg-warning/10 rounded-lg"
    >
      <UIcon name="i-lucide-alert-triangle" class="size-8 mb-2 mx-auto" />
      <p>{{ t('pages.blockRender.collectionNotFound', { name: attrs.collection }) }}</p>
    </div>

    <!-- Loading state -->
    <div
      v-else-if="pending"
      class="p-8 text-center text-muted"
    >
      <UIcon name="i-lucide-loader-2" class="size-8 mb-2 mx-auto animate-spin" />
      <p>{{ t('pages.blockRender.loading') }}</p>
    </div>

    <!-- Render collection in stateless/read-only mode -->
    <CroutonCollection
      v-else
      :collection="attrs.collection"
      :layout="layout"
      :columns="autoColumns"
      :rows="items || []"
      :stateless="true"
      :hide-default-columns="{
        select: true,
        actions: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        updatedBy: true
      }"
      class="collection-block-content"
    />
  </div>
</template>

<style scoped>
.collection-block-content :deep(.crouton-collection) {
  /* Remove any admin-specific styling */
}
</style>
