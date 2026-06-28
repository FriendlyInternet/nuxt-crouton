<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
    <!-- Header -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {{ collectionTitle }}
      </h1>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Browse and manage {{ collectionName }} data
      </p>
    </div>

    <!-- Error State -->
    <div
      v-if="error"
      class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6"
    >
      <p class="text-red-900 dark:text-red-300 font-semibold mb-2">
        Collection not found
      </p>
      <p class="text-red-700 dark:text-red-400">
        {{ error }}
      </p>
    </div>

    <!-- Collection Viewer - Uses existing Crouton components! -->
    <CroutonCollectionViewer
      v-else
      :collection-name="collectionName"
      :default-layout="layout"
    />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const collectionName = computed(() => route.params.collection as string)
const layout = computed(() => (route.query.layout as any) || 'table')

// Verify collection exists. Cast to a string-keyed record: appConfig.croutonCollections is typed
// with the concrete generated collection keys, so a dynamic lookup by the route param (an arbitrary
// string) otherwise trips TS7053 the moment a consumer type-checks this page.
const appConfig = useAppConfig()
const croutonCollections = (appConfig.croutonCollections || {}) as Record<string, unknown>
const error = ref<string | null>(null)

const collectionTitle = computed(() => {
  return collectionName.value
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim()
})

onMounted(() => {
  if (!croutonCollections[collectionName.value]) {
    error.value = `Collection "${collectionName.value}" not found in app config`
  }
})

// IMPORTANT: No auth middleware - this is DevTools only!
definePageMeta({
  layout: false // Don't use main app layout
})
</script>
