<script setup lang="ts">
/**
 * CroutonWorkspace - Split-view workspace for collection editing
 *
 * A Finder-style split-view: sidebar with item list + inline editor.
 * Works as a layout option in CollectionViewer alongside table/list/grid/tree/kanban.
 *
 * Features:
 * - Sidebar + editor split layout
 * - URL state sync via query param (?item=<id>)
 * - Selection state machine (view → create → edit)
 * - Keyboard shortcuts (N to create, / to search, Esc to close)
 * - Mobile: sidebar only, editor opens in slideover
 * - Slot overrides for sidebar and editor (used by crouton-pages)
 *
 * @example
 * <!-- Generic: zero config, uses default sidebar + form -->
 * <CroutonWorkspace collection="articles" />
 *
 * @example
 * <!-- Custom: override sidebar and editor (e.g., crouton-pages) -->
 * <CroutonWorkspace collection="pagesPages">
 *   <template #sidebar="{ selectedId, onSelect, onCreate }">
 *     <MyCustomSidebar @select="onSelect" @create="onCreate" />
 *   </template>
 *   <template #editor="{ selectedId, mode, onSave, onDelete, onCancel }">
 *     <MyCustomEditor :item-id="selectedId" @save="onSave" />
 *   </template>
 * </CroutonWorkspace>
 */
import { breakpointsTailwind, onKeyStroke } from '@vueuse/core'

interface Props {
  collection: string
}

const props = defineProps<Props>()

const { t } = useT()
const route = useRoute()
const router = useRouter()
const { camelToTitleCase } = useFormatCollections()

// Selection state
const selectedItemId = ref<string | null>(null)
const mode = ref<'view' | 'create' | 'edit'>('view')
const editorSessionKey = ref(0)

// Data fetching
const { items, pending, refresh } = await useCollectionQuery(props.collection) as any

// Initialize from URL query
onMounted(() => {
  const itemId = route.query.item as string | undefined
  if (itemId) {
    selectedItemId.value = itemId
    mode.value = 'edit'
  }
})

// Sync URL when selection changes
watch(selectedItemId, (newId) => {
  const query = { ...route.query }
  if (newId) {
    query.item = newId
  } else {
    delete query.item
  }
  router.replace({ query })
})

// Handle item selection from sidebar
function handleSelect(item: any) {
  selectedItemId.value = item.id
  mode.value = 'edit'
  editorSessionKey.value++
}

// Handle create
function handleCreate() {
  selectedItemId.value = null
  mode.value = 'create'
  editorSessionKey.value++
}

// Handle save
function handleSave(savedItem: any) {
  if (savedItem?.id) {
    selectedItemId.value = savedItem.id
    mode.value = 'edit'
  }
  refresh()
}

// Handle delete
function handleDelete() {
  selectedItemId.value = null
  mode.value = 'view'
  refresh()
}

// Handle cancel
function handleCancel() {
  if (mode.value === 'create') {
    mode.value = 'view'
    selectedItemId.value = null
  }
}

// Show editor?
const showEditor = computed(() =>
  mode.value === 'create' || (mode.value === 'edit' && !!selectedItemId.value)
)

// Mobile handling
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')

const isEditorPanelOpen = computed({
  get: () => showEditor.value,
  set: (value: boolean) => {
    if (!value) {
      selectedItemId.value = null
      mode.value = 'view'
    }
  }
})

// Sidebar ref for keyboard shortcuts
const sidebarRef = ref<{ focusSearch: () => void } | null>(null)

// Keyboard shortcuts
onKeyStroke('n', (e) => {
  const target = e.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (!isInput && !showEditor.value) {
    e.preventDefault()
    handleCreate()
  }
})

onKeyStroke('/', (e) => {
  const target = e.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (!isInput) {
    e.preventDefault()
    sidebarRef.value?.focusSearch()
  }
})
</script>

<template>
  <div class="flex h-full">
    <!-- Sidebar -->
    <div class="w-80 lg:w-96 shrink-0 border-r border-default flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-default min-h-14">
        <h3 class="text-sm font-semibold truncate">{{ camelToTitleCase(collection) }}</h3>
        <UButton
          color="primary"
          variant="ghost"
          icon="i-lucide-plus"
          size="sm"
          :aria-label="`Create ${camelToTitleCase(collection)}`"
          @click="handleCreate"
        />
      </div>

      <slot
        name="sidebar"
        :items="items"
        :pending="pending"
        :selected-id="selectedItemId"
        :on-select="handleSelect"
        :on-create="handleCreate"
      >
        <CroutonWorkspaceSidebar
          ref="sidebarRef"
          :collection="collection"
          :selected-id="selectedItemId"
          :items="items"
          :pending="pending"
          @select="handleSelect"
          @create="handleCreate"
        />
      </slot>
    </div>

    <!-- Editor (desktop) -->
    <div class="flex-1 min-w-0 hidden lg:flex flex-col">
      <template v-if="showEditor">
        <slot
          name="editor"
          :selected-id="selectedItemId"
          :mode="mode"
          :session-key="editorSessionKey"
          :on-save="handleSave"
          :on-delete="handleDelete"
          :on-cancel="handleCancel"
        >
          <CroutonWorkspaceEditor
            :key="editorSessionKey"
            :collection="collection"
            :item-id="selectedItemId"
            @save="handleSave"
            @delete="handleDelete"
            @cancel="handleCancel"
          />
        </slot>
      </template>

      <div v-else class="flex-1 flex items-center justify-center text-muted">
        <div class="text-center">
          <UIcon name="i-lucide-mouse-pointer-click" class="size-12 mb-3 opacity-30" />
          <p class="text-sm">{{ t('collection.selectItem') || 'Select an item to edit' }}</p>
          <p class="text-xs text-muted mt-1">
            {{ t('collection.orPressN') || 'or press N to create new' }}
          </p>
        </div>
      </div>
    </div>

    <!-- Mobile: Slideover for editor -->
    <ClientOnly>
      <USlideover v-if="isMobile" v-model:open="isEditorPanelOpen" side="right">
        <template #content>
          <slot
            v-if="showEditor"
            name="editor"
            :selected-id="selectedItemId"
            :mode="mode"
            :session-key="editorSessionKey"
            :on-save="handleSave"
            :on-delete="handleDelete"
            :on-cancel="handleCancel"
          >
            <CroutonWorkspaceEditor
              :key="editorSessionKey"
              :collection="collection"
              :item-id="selectedItemId"
              @save="handleSave"
              @delete="handleDelete"
              @cancel="handleCancel"
            />
          </slot>
        </template>
      </USlideover>
    </ClientOnly>
  </div>
</template>
