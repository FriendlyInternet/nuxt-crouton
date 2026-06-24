<script setup lang="ts">
import { useToggle } from '@vueuse/core'
const props = defineProps<{
  collection?: string
  crop?: boolean | { aspectRatio?: number }
}>()

const modelValue = defineModel<string>()
const emit = defineEmits<{
  select: [asset: Record<string, any>]
}>()

const [isOpen, toggleIsOpen] = useToggle(false)
const [showUploader, toggleShowUploader] = useToggle(false)
const searchQuery = ref('')
const typeFilter = ref('all')
const pendingSelection = ref<string | null>(null)

const { t } = useI18n()
const crouton = useCrouton()
const { getConfig } = useCollections()
// Resolve API path: prefer generated collection configs that have apiPath set
const collectionName = props.collection
  || getConfig('croutonAssets')?.apiPath
  || getConfig('assetsAssets')?.apiPath
  || getConfig('assets')?.apiPath
  || 'crouton-assets'

const { data: assets, pending, refresh } = await useFetch(
  () => `/api/teams/${useRoute().params.team}/${collectionName}`
)

const selectedAsset = computed(() =>
  (assets.value as any[] | null)?.find((a: any) => a.id === modelValue.value)
)

const tabs = computed(() => [
  { label: t('assets.picker.all'), value: 'all' },
  { label: t('assets.picker.images'), value: 'image' },
  { label: t('assets.picker.video'), value: 'video' },
  { label: t('assets.picker.audio'), value: 'audio' },
  { label: t('assets.picker.documents'), value: 'document' },
])


const filteredAssets = computed(() => {
  if (!assets.value) return []
  let result = assets.value as any[]

  if (typeFilter.value !== 'all') {
    result = result.filter((asset: any) =>
      getFileCategory(asset.contentType) === typeFilter.value
    )
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter((asset: any) =>
      asset.filename?.toLowerCase().includes(query)
      || asset.alt?.toLowerCase().includes(query)
    )
  }

  return result
})

const openPicker = () => {
  pendingSelection.value = modelValue.value ?? null
  isOpen.value = true
}

const handleTileClick = (asset: Record<string, any>) => {
  pendingSelection.value = asset.id
}

const confirmSelection = () => {
  if (pendingSelection.value) {
    const asset = (assets.value as any[])?.find((a: any) => a.id === pendingSelection.value)
    modelValue.value = pendingSelection.value
    if (asset) emit('select', asset)
  }
  isOpen.value = false
}

const clearSelection = (e: Event) => {
  e.stopPropagation()
  modelValue.value = undefined
  pendingSelection.value = null
}

const handleUploaded = async (close: () => void) => {
  await refresh()
  close()
  showUploader.value = false
}

const totalCount = computed(() => (assets.value as any[] | null)?.length ?? 0)

const handleEdit = (asset: Record<string, any>) => {
  crouton?.open('update', collectionName, [asset.id], 'modal')
}

const handleDelete = (asset: Record<string, any>) => {
  crouton?.open('delete', collectionName, [asset.id])
}

// Auto-refresh asset list after any mutation on this collection
useNuxtApp().hooks.hook('crouton:mutation', async (event: any) => {
  if (event.collection !== collectionName) return
  await refresh()
  // Clear selection if deleted asset was selected
  if (event.operation === 'delete' && event.itemIds?.includes(pendingSelection.value)) {
    pendingSelection.value = null
  }
})
</script>

<template>
  <div>
    <!-- Compact trigger button -->
    <button
      type="button"
      class="relative w-full rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-primary-400 transition-colors group overflow-hidden"
      :class="modelValue ? 'border-solid' : ''"
      @click="openPicker"
    >
      <!-- Selected state: thumbnail or file icon -->
      <template v-if="selectedAsset">
        <div class="flex items-center gap-3 p-3 text-left">
          <!-- Image thumbnail -->
          <div class="h-12 w-12 rounded overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <img
              v-if="isImage(selectedAsset.contentType) && selectedAsset.pathname"
              :src="`/images/${selectedAsset.pathname}`"
              :alt="selectedAsset.alt || selectedAsset.filename"
              class="w-full h-full object-cover"
            >
            <UIcon
              v-else
              :name="getFileIcon(selectedAsset.contentType)"
              class="w-6 h-6 text-gray-400"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">
              {{ selectedAsset.filename }}
            </p>
            <p class="text-xs text-gray-500 uppercase">
              {{ getFileExtension(selectedAsset.filename) }}
            </p>
          </div>
          <!-- Clear button -->
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            size="xs"
            aria-label="Clear selection"
            class="opacity-0 group-hover:opacity-100 transition-opacity"
            @click="clearSelection"
          />
        </div>
      </template>

      <!-- Empty state -->
      <template v-else>
        <div class="flex flex-col items-center justify-center gap-2 py-6 text-gray-400">
          <UIcon
            name="i-lucide-image-plus"
            class="w-8 h-8"
          />
          <span class="text-sm">{{ $t('assets.picker.selectAsset') }}</span>
        </div>
      </template>
    </button>

    <!-- Picker modal -->
    <UModal
      v-model:open="isOpen"
      size="xl"
    >
      <template #content="{ close }">
        <div class="flex flex-col h-[80vh]">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-800">
            <h3 class="text-lg font-semibold">
              {{ $t('assets.picker.title') }}
            </h3>
            <UButton
              icon="i-lucide-upload"
              :label="$t('assets.picker.upload')"
              size="sm"
              variant="soft"
              @click="showUploader = true"
            />
          </div>

          <!-- Search + filter -->
          <div class="flex flex-col gap-3 px-6 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
            <UInput
              v-model="searchQuery"
              icon="i-lucide-search"
              :placeholder="$t('assets.picker.search')"
            />
            <div class="flex gap-1">
              <button
                v-for="tab in tabs"
                :key="tab.value"
                type="button"
                class="px-3 py-1.5 text-sm rounded-md transition-colors"
                :class="typeFilter === tab.value
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'"
                @click="typeFilter = tab.value"
              >
                {{ tab.label }}
              </button>
            </div>
          </div>

          <!-- Asset grid -->
          <div class="flex-1 overflow-auto px-6 py-4">
            <div
              v-if="pending"
              class="grid grid-cols-4 gap-4"
            >
              <USkeleton
                v-for="i in 8"
                :key="i"
                class="h-32 w-full"
              />
            </div>

            <div
              v-else-if="filteredAssets.length"
              class="grid grid-cols-4 gap-4"
            >
              <CroutonAssetsAssetTile
                v-for="asset in filteredAssets"
                :key="asset.id"
                :asset="asset"
                :selected="pendingSelection === asset.id"
                :selectable="true"
                @click="handleTileClick"
                @edit="handleEdit"
                @delete="handleDelete"
              />
            </div>

            <div
              v-else
              class="flex flex-col items-center justify-center h-full text-gray-500"
            >
              <UIcon
                name="i-lucide-image-off"
                class="w-12 h-12 mb-3"
              />
              <p class="text-sm">
                {{ searchQuery || typeFilter !== 'all' ? $t('assets.picker.noResults') : $t('assets.picker.empty') }}
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-800">
            <span class="text-sm text-gray-500">{{ totalCount }} asset{{ totalCount !== 1 ? 's' : '' }}</span>
            <div class="flex gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :label="$t('assets.picker.cancel')"
                @click="close"
              />
              <UButton
                color="primary"
                :label="$t('assets.picker.select')"
                :disabled="!pendingSelection"
                @click="confirmSelection"
              />
            </div>
          </div>
        </div>

        <!-- Upload modal (nested) -->
        <UModal v-model:open="showUploader">
          <template #content="{ close: closeUploader }">
            <div class="p-6">
              <h3 class="text-lg font-semibold mb-4">
                {{ $t('assets.picker.uploadTitle') }}
              </h3>
              <CroutonAssetsUploader
                :collection="collectionName"
                @uploaded="handleUploaded(closeUploader)"
              />
            </div>
          </template>
        </UModal>
      </template>
    </UModal>
  </div>
</template>
