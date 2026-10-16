<script setup lang="ts">
/**
 * WorkspaceEditor - Generic inline editor for workspace layout
 *
 * Loads item data and renders CroutonFormDynamicLoader inline.
 * Includes a sticky toolbar with save/delete/close actions.
 */

interface Props {
  collection: string
  itemId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  itemId: null
})

const emit = defineEmits<{
  'save': [item: any]
  'delete': [id: string]
  'cancel': []
}>()

const { t } = useT()
const { getConfig } = useCollections()
const { collectionWithCapitalSingular } = useFormatCollections()
const display = useDisplayConfig(props.collection)

// Resolve the form action
const action = computed<'create' | 'update'>(() =>
  props.itemId ? 'update' : 'create'
)

// Loading and error state
const isLoading = ref(false)
const loadError = ref<string | null>(null)
const activeItem = ref<any>(null)

// Get API path from collection config
const collectionConfig = getConfig(props.collection)
const apiPath = collectionConfig?.apiPath

// Resolve display title for the toolbar
const itemTitle = computed(() => {
  if (!activeItem.value) return null
  const titleField = display.title || 'title'
  return activeItem.value[titleField] || activeItem.value.name || activeItem.value.label || null
})

// Form ref for programmatic submit
const formRef = ref<HTMLElement | null>(null)

function triggerSubmit() {
  // Find the form element and submit it
  const form = formRef.value?.querySelector('form')
  if (form) {
    form.requestSubmit()
  }
}

function triggerDelete() {
  if (props.itemId) {
    // Open delete confirmation via crouton modal
    const crouton = useCrouton()
    crouton.open('delete', props.collection, [props.itemId], 'modal')
  }
}

// Load item data when itemId changes
watch(
  () => props.itemId,
  async (newId) => {
    if (!newId) {
      // Create mode
      activeItem.value = null
      loadError.value = null
      return
    }

    // Update mode — fetch item
    isLoading.value = true
    loadError.value = null

    try {
      const { getTeamId } = useTeamContext()
      const teamId = getTeamId()

      if (!teamId || !apiPath) {
        throw new Error('Team context or API path not available')
      }

      const response = await $fetch<any>(`/api/teams/${teamId}/${apiPath}`, {
        method: 'GET',
        query: { ids: newId },
        credentials: 'include'
      })

      const item = response?.items?.[0] || response?.[0] || response
      if (!item) {
        throw new Error('Item not found')
      }

      activeItem.value = item
    } catch (error: any) {
      loadError.value = error.message || t('workspace.loadFailed')
      console.error('WorkspaceEditor: Failed to load item:', error)
    } finally {
      isLoading.value = false
    }
  },
  { immediate: true }
)

// Listen for crouton mutation events to detect saves/deletes from within the form
const nuxtApp = useNuxtApp()
nuxtApp.hook('crouton:mutation', ({ operation, collection, itemId }) => {
  if (collection !== props.collection) return

  if (operation === 'create' || operation === 'update') {
    emit('save', { id: itemId })
  } else if (operation === 'delete') {
    emit('delete', itemId as string)
  }
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Toolbar -->
    <div class="shrink-0 flex items-center justify-between px-6 py-3 border-b border-default bg-elevated/30 min-h-14">
      <div class="flex items-center gap-3 min-w-0">
        <UBadge
          :color="action === 'create' ? 'success' : 'info'"
          variant="subtle"
          size="xs"
        >
          {{ action === 'create' ? t('common.new') : t('common.editing') }}
        </UBadge>
        <span v-if="itemTitle" class="text-sm font-medium truncate">
          {{ itemTitle }}
        </span>
        <span v-else-if="action === 'create'" class="text-sm text-muted">
          {{ t('collection.newItem', { collection: collectionWithCapitalSingular(collection) }) }}
        </span>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <UButton
          v-if="action === 'update' && itemId"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          size="sm"
          @click="triggerDelete"
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') || 'Cancel' }}
        </UButton>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-save"
          @click="triggerSubmit"
        >
          {{ t('common.save') || 'Save' }}
        </UButton>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin text-muted mb-2" />
        <p class="text-sm text-muted">{{ t('common.loading') || 'Loading...' }}</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <UIcon name="i-lucide-alert-circle" class="size-8 text-error mb-2" />
        <p class="text-sm text-error">{{ loadError }}</p>
        <UButton
          size="sm"
          color="primary"
          variant="soft"
          class="mt-3"
          @click="emit('cancel')"
        >
          {{ t('common.back') || 'Back' }}
        </UButton>
      </div>
    </div>

    <!-- Form -->
    <div v-else ref="formRef" class="flex-1 min-h-0 overflow-auto p-6">
      <CroutonFormDynamicLoader
        :key="`${collection}-${action}-${activeItem?.id || 'new'}`"
        :collection="collection"
        loading="notLoading"
        :action="action"
        :items="activeItem ? [activeItem.id] : []"
        :active-item="activeItem"
      />
    </div>
  </div>
</template>
