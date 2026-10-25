<script setup lang="ts">
/**
 * Admin Collection Viewer Page
 *
 * Generic page for viewing and managing any registered collection
 * from the team admin interface.
 *
 * @route /admin/[team]/crouton/[collection]
 */
definePageMeta({
  layout: 'admin',
  middleware: ['auth', 'team-admin']
})

const route = useRoute()
const { getConfig } = useCollections()
const { collectionWithCapital } = useFormatCollections()
const { t } = useT()

const collectionName = computed(() => route.params.collection as string)

// Get collection config for display
const collectionConfig = computed(() => getConfig(collectionName.value))

// Verify collection exists in registry (reactive — no loading flash; the
// viewer's own Suspense skeleton covers the data-loading phase)
const error = computed(() =>
  collectionConfig.value ? null : t('collection.notFound', { collection: collectionName.value })
)

// Format collection name for display
const collectionTitle = computed(() => {
  const config = collectionConfig.value
  return config?.adminNav?.label || config?.displayName || collectionWithCapital(collectionName.value)
})
</script>

<template>
  <UDashboardPanel
    id="admin-collection"
    :ui="{ root: 'relative flex flex-col min-w-0 flex-1 h-full overflow-hidden' }"
  >
    <template #header>
      <UDashboardNavbar :title="collectionTitle">
        <template #leading>
          <UDashboardSidebarCollapse class="hidden lg:flex" />
        </template>
      </UDashboardNavbar>
    </template>

    <!-- Use default slot instead of body for full-height content without auto-scroll -->
    <div
      v-if="error"
      class="text-red-600 p-4"
    >
      {{ error }}
    </div>

    <CroutonCollectionViewer
      v-else
      :collection-name="collectionName"
      class="flex-1 min-h-0"
    />
  </UDashboardPanel>
</template>
