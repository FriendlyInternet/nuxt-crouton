<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Header with title and layout switcher - fixed height -->
    <div class="px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-2 shrink-0">
      <h2 class="text-lg sm:text-xl font-semibold truncate min-w-0">
        {{ camelToTitleCase(collectionName) }}
      </h2>
      <!-- Layout Switcher: inline icon group on desktop -->
      <div class="hidden sm:flex items-center gap-1 p-1 bg-muted rounded-lg shrink-0 overflow-x-auto">
        <UButton
          v-for="layoutOption in layoutOptions"
          :key="layoutOption.value"
          :icon="layoutOption.icon"
          :color="currentLayout === layoutOption.value ? 'primary' : 'neutral'"
          :variant="currentLayout === layoutOption.value ? 'solid' : 'ghost'"
          size="sm"
          :aria-label="camelToTitleCase(layoutOption.value)"
          :aria-pressed="currentLayout === layoutOption.value"
          @click="currentLayout = layoutOption.value"
        />
      </div>

      <!--
        Mobile: single consolidated header. The layout switcher collapses to a
        menu button, and the import/create actions (shown in the table navbar on
        desktop) appear here as compact icon buttons so there's one header row,
        not two. Export stays desktop-only (needs the row data). (#691, #692)
      -->
      <div class="flex sm:hidden items-center gap-1 shrink-0">
        <UDropdownMenu
          :items="switcherMenuItems"
          :content="{ align: 'end' }"
        >
          <UButton
            :icon="currentLayoutIcon"
            color="neutral"
            variant="outline"
            size="sm"
            trailing-icon="i-lucide-chevron-down"
            aria-label="Change layout"
          />
        </UDropdownMenu>

        <CroutonImportButton
          :collection="collectionName"
          color="neutral"
          variant="ghost"
          size="sm"
        >
          <template #default>
            <span class="sr-only">{{ t('common.import') }}</span>
          </template>
        </CroutonImportButton>

        <UButton
          icon="i-lucide-plus"
          color="primary"
          size="sm"
          :aria-label="t('common.create')"
          @click="handleItemAction('create')"
        />
      </div>
    </div>

    <!-- Content area - fills remaining space -->
    <div class="flex-1 min-h-0 flex">
      <!-- Left: collection layout (shrinks when inline editor is open) -->
      <div
        :class="showInlineEditor ? 'w-2/5 border-r border-default' : 'w-full'"
        class="transition-all duration-200 min-h-0 overflow-auto"
      >
        <div
          v-if="componentError"
          class="text-red-600 p-4 bg-red-50 rounded"
        >
          {{ t('collection.componentError', { error: componentError }) }}
        </div>

        <!-- Workspace layout: render CroutonWorkspace directly -->
        <CroutonWorkspace
          v-else-if="currentLayout === 'workspace'"
          :collection="collectionName"
          class="h-full"
        />

        <!-- Async generated List component — boundaried by Suspense so the
             skeleton holds until its data resolves, then reveals at once.
             effectiveLayout gives the component cards-on-mobile (#690); the
             skeleton takes the plain-string currentLayout. -->
        <Suspense v-else-if="componentName">
          <component
            :is="componentName"
            :layout="effectiveLayout"
            class="h-full"
          />
          <template #fallback>
            <CroutonCollectionSkeleton :layout="currentLayout" />
          </template>
        </Suspense>

        <div
          v-else
          class="text-gray-500"
        >
          {{ t('collection.componentNotFound', { collection: collectionName }) }}
        </div>
      </div>

      <!-- Right: inline editor panel -->
      <div v-if="showInlineEditor" class="flex-1 min-h-0 overflow-auto">
        <CroutonWorkspaceEditor
          :key="inlineSessionKey"
          :collection="collectionName"
          :item-id="inlineItemId"
          @save="handleInlineSave"
          @delete="handleInlineDelete"
          @cancel="handleInlineCancel"
        />
      </div>

      <!-- Empty state when inline mode is active but no item selected -->
      <div
        v-else-if="isInlineMode"
        class="flex-1 flex items-center justify-center text-muted"
      >
        <div class="text-center">
          <UIcon name="i-lucide-mouse-pointer-click" class="size-12 mb-3 opacity-30" />
          <p class="text-sm">{{ t('collection.selectItem') || 'Select an item to edit' }}</p>
          <p class="text-xs text-muted mt-1">
            {{ t('collection.orPressN') || 'or press N to create new' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CroutonItemAction } from '../types/table'
import { CROUTON_ITEM_ACTION_KEY } from '../types/table'

interface Props {
  collectionName: string
  defaultLayout?: 'table' | 'list' | 'grid' | 'cards' | 'tree' | 'kanban' | 'workspace'
}

const props = withDefaults(defineProps<Props>(), {
  defaultLayout: 'table'
})

const { t } = useT()
const componentError = ref<string | null>(null)
const currentLayout = ref(props.defaultLayout)

// Use composable for formatting
const { camelToTitleCase, toPascalCase } = useFormatCollections()

// Get collection config to check hierarchy support and container type
const { getConfig } = useCollections()
const collectionConfig = computed(() => getConfig(props.collectionName))

// Resolve container type from config
const container = computed(() =>
  collectionConfig.value?.container ?? 'slideover'
)
const isInlineMode = computed(() => container.value === 'inline')

// Inline editor state
const inlineItemId = ref<string | null>(null)
const inlineMode = ref<'view' | 'create' | 'edit'>('view')
const inlineSessionKey = ref(0)
const showInlineEditor = computed(() =>
  isInlineMode.value && (inlineMode.value === 'create' || (inlineMode.value === 'edit' && !!inlineItemId.value))
)

// Provide the item action handler for all child components
const crouton = useCrouton()

const handleItemAction: CroutonItemAction = (action, ids = [], initialData?) => {
  if (isInlineMode.value && action !== 'delete') {
    // Inline mode: show editor panel
    if (action === 'create') {
      inlineItemId.value = null
      inlineMode.value = 'create'
      inlineSessionKey.value++
    } else if (action === 'update' || action === 'view') {
      inlineItemId.value = ids[0] ?? null
      inlineMode.value = action === 'view' ? 'view' : 'edit'
      inlineSessionKey.value++
    }
  } else {
    // Modal/slideover/dialog mode (or delete which always uses overlay)
    const effectiveContainer = action === 'delete' ? 'modal' : container.value === 'inline' ? 'slideover' : container.value
    crouton.open(action, props.collectionName, ids, effectiveContainer as any, initialData)
  }
}

provide(CROUTON_ITEM_ACTION_KEY, handleItemAction)

// Inline editor event handlers
function handleInlineSave(savedItem: any) {
  if (savedItem?.id) {
    inlineItemId.value = savedItem.id
    inlineMode.value = 'edit'
  }
  inlineSessionKey.value++
}

function handleInlineDelete() {
  inlineItemId.value = null
  inlineMode.value = 'view'
}

function handleInlineCancel() {
  if (inlineMode.value === 'create') {
    inlineMode.value = 'view'
    inlineItemId.value = null
  }
}

// All available layout options
const allLayoutOptions = [
  { value: 'table' as const, icon: 'i-lucide-table' },
  { value: 'list' as const, icon: 'i-lucide-list' },
  { value: 'grid' as const, icon: 'i-lucide-grid-3x3' },
  { value: 'cards' as const, icon: 'i-lucide-layout-grid' },
  { value: 'tree' as const, icon: 'i-lucide-git-branch' },
  { value: 'kanban' as const, icon: 'i-lucide-columns-3' },
  { value: 'workspace' as const, icon: 'i-lucide-panel-left' }
]

// Filter layout options - show tree if hierarchy OR sortable is enabled
// Kanban is always available as it auto-detects groupable fields
const layoutOptions = computed(() => {
  const config = collectionConfig.value
  const supportsTree = config?.hierarchy?.enabled || config?.sortable?.enabled

  let options = allLayoutOptions

  // Hide tree if not supported
  if (!supportsTree) {
    options = options.filter(o => o.value !== 'tree')
  }

  return options
})

// On mobile the table scrolls sideways and feels broken, so fall back to the
// card/list layout below `sm` while keeping the table at `sm+`. The switcher
// still reports `table` as selected; other layouts pass through unchanged.
const effectiveLayout = computed(() =>
  currentLayout.value === 'table'
    ? { base: 'list' as const, sm: 'table' as const }
    : currentLayout.value
)

// Icon for the current layout, shown on the mobile switcher menu button
const currentLayoutIcon = computed(() =>
  allLayoutOptions.find(o => o.value === currentLayout.value)?.icon
    ?? 'i-lucide-table'
)

// Mobile switcher: same options as the desktop group, as a dropdown menu
const switcherMenuItems = computed(() =>
  layoutOptions.value.map(o => ({
    label: camelToTitleCase(o.value),
    icon: o.icon,
    onSelect: () => { currentLayout.value = o.value }
  }))
)

// Convert collection name to component name
// e.g., translationsUi -> TranslationsUiList
// e.g., teamTranslations -> TeamTranslationsList
// e.g., posProducts -> PosProductsList
const componentName = computed(() => {
  if (!props.collectionName) return null
  return `${toPascalCase(props.collectionName)}List`
})

// Try to resolve the component
onMounted(async () => {
  if (!componentName.value) return

  try {
    // Check if component exists in the global scope
    const globalComponents = getCurrentInstance()?.appContext.components
    if (!globalComponents || !globalComponents[componentName.value]) {
      // Component might be auto-imported but not registered yet
      // This is fine, Vue will handle it
      console.debug(`Component ${componentName.value} will be resolved by auto-import`)
    }
  } catch (err) {
    componentError.value = err instanceof Error ? err.message : String(err)
  }
})
</script>
