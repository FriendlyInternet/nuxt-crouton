<script setup lang="ts">
/**
 * CroutonWorkspaceLayout - Reusable split-panel workspace shell
 *
 * Provides the shared layout and state management for page-level workspaces:
 * - Resizable sidebar (UDashboardPanel) + content panel
 * - Selection state machine (view → create → edit)
 * - URL query param sync (?item=<id>)
 * - Mobile: sidebar only, content opens in USlideover
 * - Keyboard shortcuts (N to create, / to search)
 *
 * Consumers provide their own sidebar and content via slots.
 * Used by crouton-pages workspace and crouton-flow workspace.
 *
 * @example
 * <CroutonWorkspaceLayout
 *   query-param="page"
 *   title="Pages"
 *   v-model="selectedPageId"
 * >
 *   <template #sidebar-actions>
 *     <UButton icon="i-lucide-plus" @click="..." />
 *   </template>
 *   <template #sidebar="{ selectedId, onSelect, onCreate }">
 *     <MySidebar @select="onSelect" @create="onCreate" />
 *   </template>
 *   <template #content="{ selectedId, mode, sessionKey }">
 *     <MyEditor :key="sessionKey" :item-id="selectedId" />
 *   </template>
 * </CroutonWorkspaceLayout>
 */
import { breakpointsTailwind, onKeyStroke } from '@vueuse/core'

interface Props {
  /** v-model for selected item ID */
  modelValue?: string | null
  /** UDashboardPanel id for sidebar */
  sidebarId?: string
  /** URL query param name for selection persistence */
  queryParam?: string
  /** Navbar title */
  title?: string
  /** Default sidebar size as % */
  sidebarSize?: number
  /** Min sidebar size as % */
  sidebarMinSize?: number
  /** Max sidebar size as % */
  sidebarMaxSize?: number
  /** Enable N keyboard shortcut for create */
  createShortcut?: boolean
  /** Enable / keyboard shortcut for search */
  searchShortcut?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: null,
  sidebarId: 'workspace-sidebar',
  queryParam: 'item',
  title: '',
  sidebarSize: 25,
  sidebarMinSize: 15,
  sidebarMaxSize: 40,
  createShortcut: true,
  searchShortcut: true,
})

const emit = defineEmits<{
  'update:modelValue': [id: string | null]
}>()

const route = useRoute()
const router = useRouter()

// Selection state
const selectedId = ref<string | null>(props.modelValue)
const mode = ref<'view' | 'create' | 'edit'>('view')
const sessionKey = ref(0)

// Sync with v-model
watch(() => props.modelValue, (newVal) => {
  if (newVal !== selectedId.value) {
    selectedId.value = newVal
    if (newVal) {
      mode.value = 'edit'
    }
  }
})

watch(selectedId, (newVal) => {
  emit('update:modelValue', newVal)
})

// Initialize from URL query
onMounted(() => {
  const id = route.query[props.queryParam] as string | undefined
  if (id) {
    selectedId.value = id
    mode.value = 'edit'
  }
})

// Sync URL when selection changes
watch(selectedId, (newId) => {
  const query = { ...route.query }
  if (newId) {
    query[props.queryParam] = newId
  } else {
    delete query[props.queryParam]
  }
  router.replace({ query })
})

// State machine handlers — passed to slots as callbacks
function handleSelect(item: any) {
  selectedId.value = typeof item === 'string' ? item : item.id
  mode.value = 'edit'
  sessionKey.value++
}

function handleCreate() {
  selectedId.value = null
  mode.value = 'create'
  sessionKey.value++
}

function handleSave(savedItem?: any) {
  if (savedItem?.id) {
    selectedId.value = savedItem.id
    mode.value = 'edit'
  }
}

function handleDelete() {
  selectedId.value = null
  mode.value = 'view'
}

function handleCancel() {
  if (mode.value === 'create') {
    mode.value = 'view'
    selectedId.value = null
  }
}

// Show content panel?
const showContent = computed(() =>
  mode.value === 'create' || (mode.value === 'edit' && !!selectedId.value)
)

// Mobile handling
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')

const isContentPanelOpen = computed({
  get: () => showContent.value,
  set: (value: boolean) => {
    if (!value) {
      selectedId.value = null
      mode.value = 'view'
    }
  }
})

// Sidebar ref for keyboard shortcuts
const sidebarRef = ref<{ focusSearch?: () => void } | null>(null)

// Keyboard shortcuts
onKeyStroke('n', (e) => {
  if (!props.createShortcut) return
  const target = e.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (!isInput && !showContent.value) {
    e.preventDefault()
    handleCreate()
  }
})

onKeyStroke('/', (e) => {
  if (!props.searchShortcut) return
  const target = e.target as HTMLElement
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  if (!isInput) {
    e.preventDefault()
    sidebarRef.value?.focusSearch?.()
  }
})

// Slot props bundle — reused across desktop and mobile content
const contentSlotProps = computed(() => ({
  selectedId: selectedId.value,
  mode: mode.value,
  sessionKey: sessionKey.value,
  onSave: handleSave,
  onDelete: handleDelete,
  onCancel: handleCancel,
}))

const sidebarSlotProps = computed(() => ({
  selectedId: selectedId.value,
  mode: mode.value,
  onSelect: handleSelect,
  onCreate: handleCreate,
}))

// Expose for programmatic control
defineExpose({
  select: handleSelect,
  create: handleCreate,
  focusSearch: () => sidebarRef.value?.focusSearch?.(),
  selectedId: readonly(selectedId),
  mode: readonly(mode),
})
</script>

<template>
  <!-- Panel 1: Resizable sidebar -->
  <UDashboardPanel
    :id="sidebarId"
    :default-size="sidebarSize"
    :min-size="sidebarMinSize"
    :max-size="sidebarMaxSize"
    resizable
  >
    <UDashboardNavbar :title="title">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>

      <template #right>
        <slot name="sidebar-actions" v-bind="sidebarSlotProps" />
      </template>
    </UDashboardNavbar>

    <slot name="sidebar" v-bind="sidebarSlotProps" />
  </UDashboardPanel>

  <!-- Panel 2: Content (desktop) -->
  <UDashboardPanel :id="`${sidebarId}-content`" class="hidden lg:flex">
    <template v-if="showContent">
      <slot name="content" v-bind="contentSlotProps" />
    </template>

    <slot v-else name="empty" v-bind="sidebarSlotProps">
      <div class="flex-1 flex items-center justify-center text-muted">
        <div class="text-center">
          <UIcon name="i-lucide-mouse-pointer-click" class="size-12 mb-3 opacity-30" />
          <p class="text-sm">{{ $t('workspace.selectItem') }}</p>
          <p class="text-xs text-muted mt-1">{{ $t('workspace.pressNToCreate') }}</p>
        </div>
      </div>
    </slot>
  </UDashboardPanel>

  <!-- Mobile: Slideover for content -->
  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isContentPanelOpen" side="right">
      <template #content>
        <div class="flex h-full flex-col">
          <!-- Back bar: the full-screen slideover leaves no tappable backdrop,
               so this is the only way to dismiss the detail and return to the
               sidebar list. Consumer content slots carry no close affordance. -->
          <div class="flex items-center gap-1.5 shrink-0 px-2 py-1.5 border-b border-default bg-elevated/30">
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-arrow-left"
              size="sm"
              :aria-label="$t('common.back')"
              @click="isContentPanelOpen = false"
            />
            <span v-if="title" class="text-sm font-medium text-muted truncate">{{ title }}</span>
          </div>

          <div class="flex-1 min-h-0 overflow-hidden">
            <slot
              v-if="showContent"
              name="content"
              v-bind="contentSlotProps"
            />
          </div>
        </div>
      </template>
    </USlideover>
  </ClientOnly>
</template>