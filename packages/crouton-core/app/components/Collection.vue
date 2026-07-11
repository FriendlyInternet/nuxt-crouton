<template>
  <div class="crouton-collection">
    <!-- Table Layout -->
    <CroutonTable
      v-if="activeLayout === 'table'"
    :collection="collection"
    :columns="columns"
    :rows="rows"
    :server-pagination="serverPagination"
    :pagination-data="paginationData"
    :refresh-fn="refreshFn"
    :hide-default-columns="hideDefaultColumns"
    :sortable="sortable"
    :stateless="stateless"
    :show-collab-presence="showCollabPresence"
    class="h-full"
  >
    <template #header>
      <slot name="header">
        <CroutonTableHeader
          v-if="create"
          :collection="collection"
          :create-button="create"
          :rows="rows"
        />
      </slot>
    </template>

    <!-- Pass through all data slots -->
    <template
      v-for="(_, slot) of $slots"
      :key="slot"
      #[slot]="scope"
    >
      <slot
        :name="slot"
        v-bind="scope"
      />
    </template>
  </CroutonTable>

  <!-- List Layout -->
  <UDashboardPanel
    v-else-if="activeLayout === 'list'"
    :id="collection || 'crouton-list'"
  >
    <template #header>
      <slot name="header">
        <div
          v-if="create"
          class="flex items-center justify-end px-4 py-2 border-b border-default"
        >
          <UButton
            color="primary"
            size="xs"
            :variant="getVariant('solid')"
            @click="handleCreate"
          >
            {{ t('common.create') }}
          </UButton>
        </div>
      </slot>
    </template>

    <template #body>
      <ul
        v-if="rows && rows.length > 0"
        role="list"
        class="divide-y divide-default"
      >
        <li
          v-for="(row, index) in rows"
          :key="row.id || index"
          class="py-3 px-4 sm:px-6 hover:bg-muted/50 transition-colors"
        >
          <component
            :is="customCardComponent || CroutonDefaultCard"
            :item="row"
            :layout="'list'"
            :collection="collection"
            :stateless="stateless"
            class="flex-1 min-w-0"
          >
            <template v-if="collabEditingBadgeComponent && row.id" #presence>
              <component
                :is="collabEditingBadgeComponent"
                :room-id="getCollabRoomId(row)"
                :room-type="collabConfig.roomType || collection"
                :current-user-id="collabConfig.currentUserId"
                :poll-interval="collabConfig.pollInterval || 5000"
                :show-self="collabConfig.showSelf"
                size="sm"
                variant="avatars"
              />
            </template>
          </component>
        </li>
      </ul>

      <div
        v-else
        class="text-center text-muted p-8"
      >
        <p class="text-lg font-medium">
          {{ t('collection.noItemsYet') }}
        </p>
        <p class="text-sm mt-1">
          {{ t('collection.createFirstItem', { collection }) }}
        </p>
      </div>

      <!-- Pagination -->
      <div
        v-if="serverPagination && paginationData"
        class="p-4 border-t border-default"
      >
        <CroutonTablePagination
          :page="paginationData.currentPage"
          :page-count="paginationData.pageSize"
          :total-items="paginationData.totalItems"
          @update:page="emit('update:page', $event)"
          @update:page-count="emit('update:pageCount', $event)"
        />
      </div>
    </template>
  </UDashboardPanel>

  <!-- Grid Layout (with size variants: compact, comfortable, spacious) -->
  <div v-else-if="activeLayout === 'grid'">
    <slot name="header">
      <div
        v-if="create"
        class="flex items-center justify-end px-4 py-2 border-b border-default"
      >
        <UButton
          color="primary"
          size="xs"
          :variant="getVariant('solid')"
          @click="handleCreate"
        >
          {{ t('common.create') }}
        </UButton>
      </div>
    </slot>

    <div
      v-if="rows && rows.length > 0"
      :class="gridContainerClasses"
    >
      <component
        v-for="(row, index) in rows"
        :key="row.id || index"
        :is="customCardComponent || CroutonDefaultCard"
        :item="row"
        layout="grid"
        :collection="collection"
        :size="effectiveGridSize"
        :stateless="stateless"
      >
        <template v-if="collabEditingBadgeComponent && row.id" #presence>
          <component
            :is="collabEditingBadgeComponent"
            :room-id="getCollabRoomId(row)"
            :room-type="collabConfig.roomType || collection"
            :current-user-id="collabConfig.currentUserId"
            :poll-interval="collabConfig.pollInterval || 5000"
            :show-self="collabConfig.showSelf"
            size="sm"
            variant="avatars"
          />
        </template>
      </component>
    </div>

    <div
      v-else
      class="text-center text-muted p-8"
    >
      <p class="text-lg font-medium">
        {{ t('collection.noItemsYet') }}
      </p>
      <p class="text-sm mt-1">
        {{ t('collection.createFirstItem', { collection }) }}
      </p>
    </div>

    <!-- Pagination -->
    <div
      v-if="serverPagination && paginationData"
      class="p-4 border-t border-default"
    >
      <CroutonTablePagination
        :page="paginationData.currentPage"
        :page-count="paginationData.pageSize"
        :total-items="paginationData.totalItems"
        @update:page="emit('update:page', $event)"
        @update:page-count="emit('update:pageCount', $event)"
      />
    </div>
  </div>

  <!-- Tree Layout -->
  <CroutonTree
    v-else-if="activeLayout === 'tree'"
    :rows="rows"
    :collection="collection"
    :hierarchy="hierarchyConfig"
    :card-component="customCardComponent"
    :show-collab-presence="showCollabPresence"
    @move="handleTreeMove"
  >
    <template #header>
      <slot name="header">
        <div
          v-if="create"
          class="flex items-center justify-end px-4 py-2 border-b border-default"
        >
          <UButton
            color="primary"
            size="xs"
            @click="handleCreate"
          >
            {{ t('common.create') }}
          </UButton>
        </div>
      </slot>
    </template>
  </CroutonTree>

  <!-- Kanban Layout -->
  <div
    v-else-if="activeLayout === 'kanban'"
    class="h-full"
  >
    <slot name="header">
      <div
        v-if="create"
        class="flex items-center justify-end px-4 py-2 border-b border-default"
      >
        <UButton
          color="primary"
          size="xs"
          :variant="getVariant('solid')"
          @click="handleCreate"
        >
          {{ t('common.create') }}
        </UButton>
      </div>
    </slot>

    <CroutonKanban
      :rows="rows"
      :collection="collection"
      :group-field="kanbanConfig?.groupField || 'status'"
      :order-field="kanbanConfig?.orderField || 'order'"
      :columns="kanbanConfig?.columns"
      :card-component="customCardComponent"
      :show-counts="kanbanConfig?.showCounts !== false"
      :show-field-selector="true"
      @move="handleKanbanMove"
      @select="handleKanbanSelect"
    />
  </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, resolveComponent, getCurrentInstance, provide, inject, type Component } from 'vue'
import { CROUTON_ITEM_ACTION_KEY } from '../types/table'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'
import type { ListProps, LayoutType, ResponsiveLayout, layoutPresets, HierarchyConfig, SortableOptions, KanbanConfig, CollabPresenceConfig, GridSize } from '../types/table'
import { layoutPresets as presets } from '../types/table'

// Version logging for debugging
const CROUTON_VERSION = '1.8.0'
const COLLECTION_FIX = 'Consolidated grid/cards layouts with size prop'

// Resolve default card component for fallback
const CroutonDefaultCard = resolveComponent('CroutonDefaultCard')

const props = withDefaults(defineProps<ListProps>(), {
  layout: 'table',
  columns: () => [],
  rows: () => [],
  collection: '',
  serverPagination: false,
  paginationData: null,
  refreshFn: undefined,
  create: false,
  card: undefined,
  cardComponent: undefined,
  stateless: false,
  showCollabPresence: false,
  gridSize: 'comfortable',
  hideDefaultColumns: () => ({
    select: false,
    createdAt: false,
    updatedAt: false,
    createdBy: false,
    updatedBy: false,
    presence: false,
    actions: false
  })
})

const emit = defineEmits<{
  'move': [payload: { id: string; newParentId: string | null; newOrder: number }]
  'kanban-move': [payload: { id: string; newValue: string | null; newOrder: number }]
  'kanban-select': [item: any]
  'create': []
  'update:page': [value: number]
  'update:pageCount': [value: number]
}>()

const { t } = useT()

// Card component resolution
const { toPascalCase } = useFormatCollections()

// Get collection config for hierarchy settings
const { getConfig } = useCollections()
const collectionConfig = computed(() => props.collection ? getConfig(props.collection) : null)

const getCardComponent = (collectionName: string, variant?: string): Component | null => {
  const pascalName = toPascalCase(collectionName)
  const componentName = variant
    ? `${pascalName}${variant}`
    : `${pascalName}Card`

  // Check if component exists without triggering Vue warning
  const instance = getCurrentInstance()
  if (!instance) return null

  // Check global components (Nuxt auto-imports register here)
  const appComponents = instance.appContext.components
  if (appComponents[componentName]) {
    const resolved = resolveComponent(componentName)
    // resolveComponent returns string if not found, but we've verified it exists
    return typeof resolved === 'string' ? null : resolved
  }

  // Also check lazy variants (LazyBookingsPagesCard)
  const lazyName = `Lazy${componentName}`
  if (appComponents[lazyName]) {
    const resolved = resolveComponent(lazyName)
    return typeof resolved === 'string' ? null : resolved
  }

  return null // No warning emitted
}

const customCardComponent = computed(() => {
  // Use direct cardComponent prop if provided (stateless mode)
  if (props.cardComponent) return props.cardComponent
  // Skip resolution in stateless mode without cardComponent
  if (props.stateless) return null
  // Normal resolution by collection name
  return props.collection ? getCardComponent(props.collection, props.card) : null
})

// Grid size configuration
// Supports backward compat: 'cards' layout maps to 'spacious', regular 'grid' defaults to 'comfortable'
const effectiveGridSize = computed<GridSize>(() => {
  return props.gridSize || 'comfortable'
})

// Grid container classes based on size
const gridContainerClasses = computed(() => {
  const size = effectiveGridSize.value
  switch (size) {
    case 'compact':
      // 4 columns on large, tight spacing (old 'grid' layout)
      return 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-3'
    case 'spacious':
      // 2-3 columns, generous spacing (old 'cards' layout)
      return 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6'
    case 'comfortable':
    default:
      // 3 columns, medium spacing (default)
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4'
  }
})

// Badge/icon position classes based on grid size
// Info icon goes bottom-left to avoid overlap with action buttons (top-right)
const gridBadgePositionClasses = computed(() => {
  const size = effectiveGridSize.value
  return size === 'spacious' ? 'absolute bottom-3 left-3' : 'absolute bottom-2 left-2'
})

// Collaboration presence support
// Resolves CollabEditingBadge component if nuxt-crouton-collab is installed
const collabEditingBadgeComponent = computed<Component | null>(() => {
  if (!props.showCollabPresence) {
    return null
  }

  // Use resolveComponent directly - Nuxt auto-imports won't appear in appContext.components
  // resolveComponent returns a string if not found, otherwise returns the component
  try {
    const resolved = resolveComponent('CollabEditingBadge')
    if (typeof resolved !== 'string') return resolved

    // Try lazy variant
    const lazyResolved = resolveComponent('LazyCollabEditingBadge')
    if (typeof lazyResolved !== 'string') return lazyResolved
  } catch {
    // Component not available
  }

  return null
})

// Provide the resolved component for child components (Tree, TreeView, TreeNode)
// This ensures they can access it without their own resolveComponent calls failing
provide('collabEditingBadgeComponent', collabEditingBadgeComponent)

// Collab presence configuration
const collabConfig = computed<CollabPresenceConfig>(() => {
  if (typeof props.showCollabPresence === 'object') {
    return props.showCollabPresence
  }
  return {}
})

// Get room ID for a row
function getCollabRoomId(row: any): string {
  if (collabConfig.value.getRoomId) {
    return collabConfig.value.getRoomId(row, props.collection)
  }
  // Default: {collection}-{id}
  return `${props.collection}-${row.id}`
}

// Responsive breakpoint detection
const breakpoints = useBreakpoints(breakpointsTailwind)

// Normalize layout prop to ResponsiveLayout format
const normalizedLayout = computed((): ResponsiveLayout => {
  const { layout } = props

  // If it's a preset name, use the preset
  if (typeof layout === 'string' && layout in presets) {
    return presets[layout as keyof typeof presets]!
  }

  // If it's a simple string layout, apply to all breakpoints
  if (typeof layout === 'string') {
    return { base: layout as LayoutType }
  }

  // If it's already a responsive layout object, use it
  if (layout && typeof layout === 'object') {
    return layout as ResponsiveLayout
  }

  // Default fallback
  return { base: 'table' }
})

// Determine active layout based on current breakpoint
const activeLayout = computed<LayoutType>(() => {
  const layout = normalizedLayout.value

  // Check breakpoints from largest to smallest
  if (breakpoints['2xl'].value && layout['2xl']) return layout['2xl']
  if (breakpoints.xl.value && layout.xl) return layout.xl
  if (breakpoints.lg.value && layout.lg) return layout.lg
  if (breakpoints.md.value && layout.md) return layout.md
  if (breakpoints.sm.value && layout.sm) return layout.sm

  return layout.base
})

// Hierarchy config for tree layout - read from collection config
// Supports both hierarchy (with nesting) and sortable (flat reorder only)
const hierarchyConfig = computed<HierarchyConfig>(() => {
  // Use prop directly if provided
  if (props.hierarchy) return props.hierarchy

  // In stateless mode, default to disabled
  if (props.stateless) return { enabled: false }

  const hierConfig = collectionConfig.value?.hierarchy
  const sortConfig = collectionConfig.value?.sortable

  // Full hierarchy mode - allows nesting and reordering
  if (hierConfig?.enabled) {
    return {
      enabled: true,
      allowNesting: true,
      parentField: hierConfig.parentField || 'parentId',
      orderField: hierConfig.orderField || 'order',
      pathField: hierConfig.pathField || 'path',
      depthField: hierConfig.depthField || 'depth'
    }
  }

  // Sortable mode - flat list, reorder only (no nesting)
  if (sortConfig?.enabled) {
    return {
      enabled: true,
      allowNesting: false,
      orderField: sortConfig.orderField || 'order'
    }
  }

  // Default to disabled for collections without hierarchy/sortable config
  return { enabled: false }
})

// Kanban config - read from collection config or defaults
const kanbanConfig = computed<KanbanConfig | null>(() => {
  // In stateless mode, use defaults
  if (props.stateless) {
    return { groupField: 'status', orderField: 'order' }
  }

  const config = collectionConfig.value?.kanban as KanbanConfig | undefined
  if (config) return config

  // Default kanban config
  return { groupField: 'status', orderField: 'order' }
})

// Tree mutation for drag-drop reordering (skip in stateless mode)
const treeMutation = (!props.stateless && props.collection) ? useTreeMutation(props.collection) : null

// Kanban mutation for column changes (uses regular collection mutation)
const kanbanMutation = (!props.stateless && props.collection) ? useCollectionMutation(props.collection) : null

// Handle tree move events (drag-drop reordering)
async function handleTreeMove(id: string, newParentId: string | null, newOrder: number) {
  // Always emit for external handling
  emit('move', { id, newParentId, newOrder })

  // In stateless mode, just emit - don't persist
  if (props.stateless) return

  if (!treeMutation) return

  try {
    await treeMutation.moveNode(id, newParentId, newOrder)
  } catch (_error) {
    // Error is already handled by treeMutation with toast notification
  }
}

// Handle kanban move events (column changes and reordering)
async function handleKanbanMove(payload: { id: string; newValue: string | null; newOrder: number }) {
  const { id, newValue, newOrder } = payload

  // Always emit for external handling
  emit('kanban-move', payload)

  // In stateless mode, just emit - don't persist
  if (props.stateless) return

  if (!kanbanMutation) return

  const groupField = kanbanConfig.value?.groupField || 'status'
  const orderField = kanbanConfig.value?.orderField || 'order'

  try {
    await kanbanMutation.update(id, {
      [groupField]: newValue,
      [orderField]: newOrder
    })
  } catch (_error) {
    // Error is already handled by kanbanMutation with toast notification
  }
}

// Item action: use provided handler (inline-aware) or fall back to crouton.open()
const itemAction = inject(CROUTON_ITEM_ACTION_KEY, undefined)

// Handle kanban card selection
function handleKanbanSelect(item: any) {
  emit('kanban-select', item)

  // In stateless mode, just emit
  if (props.stateless) return

  // Open the item in edit mode
  if (itemAction) {
    itemAction('update', Array.isArray(item) ? item : [item.id ?? item])
  } else {
    crouton?.open('update', props.collection, item)
  }
}

// Crouton actions (skip in stateless mode)
const crouton = props.stateless ? null : useCrouton()

function handleCreate() {
  if (props.stateless) {
    emit('create')
  } else if (itemAction) {
    itemAction('create')
  } else {
    const container = getConfig(props.collection)?.container ?? 'slideover'
    crouton?.open('create', props.collection, [], container)
  }
}

// Theme variant support
const getVariant = (base: string) => {
  try {
    // @ts-ignore - composable only exists when the crouton-themes layer is extended
    const switcher = useThemeSwitcher?.()
    return switcher?.getVariant?.(base) ?? base
  } catch {
    return base
  }
}
</script>
