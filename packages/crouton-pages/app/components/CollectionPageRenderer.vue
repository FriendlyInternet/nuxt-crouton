<script setup lang="ts">
/**
 * Collection Page Renderer
 *
 * Bridge component between the page system and collections. When a page
 * references a publishable collection item, this component fetches the
 * item and renders it using the collection's Detail component.
 *
 * Resolution chain: {CollectionName}Detail → CroutonDetail (generic fallback)
 *
 * Handles orphaned references gracefully — if the item is deleted or
 * inaccessible, shows a placeholder without breaking the page.
 */

interface TranslationData {
  title?: string
  slug?: string
  content?: string
}

interface PageRecord {
  id: string
  teamId: string
  title: string
  slug: string
  pageType: string
  content?: string | null
  config?: Record<string, unknown> | null
  status: string
  visibility: string
  showInNavigation: boolean
  parentId?: string | null
  order: number
  translations?: Record<string, TranslationData>
}

interface Props {
  /** The page record being rendered */
  page: PageRecord
}

const props = defineProps<Props>()

const { getPageType } = usePageTypes()
const collections = useCollections()
const { getTeamId } = useTeamContext()

// Resolve collection name from page type
const pageType = computed(() => getPageType(props.page.pageType))
const collectionName = computed(() => (pageType.value as any)?.collection)

// Item ID stored in page config
const itemId = computed(() => props.page.config?.itemId as string | undefined)

// Get collection API path
const apiPath = computed(() => {
  if (!collectionName.value) return null
  const config = collections.getConfig(collectionName.value)
  return config?.apiPath
})

// Fetch the collection item
const teamId = getTeamId()
const {
  data: item,
  status: fetchStatus,
  error: fetchError
} = await useFetch<Record<string, any>>(() => {
  if (!teamId || !apiPath.value || !itemId.value) return null as any
  return `/api/teams/${teamId}/${apiPath.value}?ids=${itemId.value}`
}, {
  transform: (response: any) => {
    // API may return { items: [...] } or array or single item
    const items = response?.items || response
    if (Array.isArray(items)) return items[0] || null
    return items
  },
  watch: [itemId, apiPath]
})

// Resolve detail component: {CollectionName}Detail → CroutonDetail
const detailComponent = computed(() => {
  if (!collectionName.value) return null

  const config = collections.getConfig(collectionName.value)
  if (!config) return null

  // Try per-collection detail component (e.g., StoreBikesDetail)
  const detailName = canonicalDetailName(collectionName.value)
  try {
    const component = resolveComponent(detailName)
    if (typeof component !== 'string') return component
  } catch {
    // Not found
  }

  // Fall back to CroutonDetail generic
  try {
    const generic = resolveComponent('CroutonDetail')
    if (typeof generic !== 'string') return generic
  } catch {
    // Not available
  }

  return null
})

const isLoading = computed(() => fetchStatus.value === 'pending')
const isOrphaned = computed(() =>
  fetchStatus.value === 'success' && !item.value
  || fetchStatus.value === 'error'
)
const { t } = useT()
</script>

<template>
  <div class="collection-page-renderer">
    <!-- Missing configuration -->
    <div
      v-if="!collectionName || !itemId"
      class="p-8 text-center"
    >
      <UIcon name="i-lucide-link-2-off" class="size-12 text-muted mb-4 mx-auto block" />
      <h2 class="text-lg font-semibold mb-2">{{ t('pages.collection.noItemSelected') }}</h2>
      <p class="text-muted text-sm">
        {{ t('pages.collection.noItemSelectedDescription') }}
      </p>
    </div>

    <!-- Loading -->
    <div
      v-else-if="isLoading"
      class="flex items-center justify-center py-12"
    >
      <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted" />
    </div>

    <!-- Orphaned reference (item deleted or inaccessible) -->
    <div
      v-else-if="isOrphaned"
      class="p-8 text-center"
    >
      <UIcon name="i-lucide-unlink" class="size-12 text-warning mb-4 mx-auto block" />
      <h2 class="text-lg font-semibold mb-2">{{ t('pages.collection.itemUnavailable') }}</h2>
      <p class="text-muted text-sm">
        {{ t('pages.collection.itemUnavailableDescription') }}
      </p>
    </div>

    <!-- Render the collection item detail -->
    <component
      v-else-if="item && detailComponent"
      :is="detailComponent"
      :item="item"
      :collection="collectionName"
      :page="page"
    />

    <!-- No detail component available -->
    <div
      v-else-if="item"
      class="p-8 text-center"
    >
      <UIcon name="i-lucide-eye-off" class="size-12 text-muted mb-4 mx-auto block" />
      <h2 class="text-lg font-semibold mb-2">{{ t('pages.collection.previewUnavailable') }}</h2>
      <p class="text-muted text-sm">
        {{ t('pages.collection.previewUnavailableDescription') }}
      </p>
    </div>
  </div>
</template>
