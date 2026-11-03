<script lang="ts" setup>
import { computed, ref, watch, type Component } from 'vue'
import type { KanbanColumnConfig, CollabPresenceConfig } from '../types/table'
import { useKanban, detectGroupableFields } from '../composables/useKanban'

interface Props {
  /** Items to display in the kanban board */
  rows: any[]
  /** Collection name */
  collection: string
  /** Field to group items by */
  groupField?: string
  /** Field for ordering within columns */
  orderField?: string
  /** Static column configuration */
  columns?: KanbanColumnConfig[]
  /** Card component to render */
  cardComponent?: Component | null
  /** Show column item counts */
  showCounts?: boolean
  /** Allow user to select grouping field */
  showFieldSelector?: boolean
  /** Fields available for grouping (auto-detected if not provided) */
  groupableFields?: string[]
  /** Show collaboration presence badges on cards */
  showCollabPresence?: boolean | CollabPresenceConfig
}

const props = withDefaults(defineProps<Props>(), {
  rows: () => [],
  collection: '',
  groupField: 'status',
  orderField: 'order',
  columns: undefined,
  cardComponent: null,
  showCounts: true,
  showFieldSelector: false,
  groupableFields: undefined,
  showCollabPresence: false
})

const emit = defineEmits<{
  /** Emitted when an item is moved to a different column or reordered */
  move: [payload: { id: string; newValue: string | null; newOrder: number }]
  /** Emitted when a card is clicked/selected */
  select: [item: any]
  /** Emitted when the group field changes */
  'update:groupField': [field: string]
}>()

const { t } = useT()

// Allow dynamic group field selection
const activeGroupField = ref(props.groupField)

// Watch for prop changes
watch(() => props.groupField, (newField: string) => {
  activeGroupField.value = newField
})

// Auto-detect groupable fields if not provided
const detectedFields = computed(() => {
  if (props.groupableFields && props.groupableFields.length > 0) {
    return props.groupableFields.map(field => ({ field, uniqueValues: 0 }))
  }
  return detectGroupableFields(props.rows)
})

// Field selector options
const fieldOptions = computed(() => {
  return detectedFields.value.map(({ field, uniqueValues }) => ({
    label: formatFieldLabel(field),
    value: field,
    badge: uniqueValues > 0 ? `${uniqueValues}` : undefined
  }))
})

// Use kanban composable - pass activeGroupField as ref for reactivity
const {
  groupedItems,
  draggingId,
  startDrag,
  endDrag,
  setDropTarget,
  isDropTarget
} = useKanban({
  items: computed(() => props.rows),
  groupField: activeGroupField,
  orderField: props.orderField,
  columns: props.columns,
  showUncategorized: true,
  uncategorizedLabel: t('kanban.uncategorized')
})

// Re-initialize kanban when group field changes
watch(activeGroupField, () => {
  emit('update:groupField', activeGroupField.value)
})

// Handle move event from column
async function handleMove(itemId: string, newColumnValue: string | null, newOrder: number) {
  emit('move', { id: itemId, newValue: newColumnValue, newOrder })
}

// Handle card selection
function handleSelect(item: any) {
  emit('select', item)
}

// Handle drag events
function handleDragStart(itemId: string) {
  startDrag(itemId)
}

function handleDragEnd() {
  endDrag()
}

// Format field name as label
function formatFieldLabel(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
</script>

<template>
  <div class="kanban-board flex flex-col h-full">
    <!-- Header with field selector -->
    <div
      v-if="showFieldSelector && fieldOptions.length > 1"
      class="flex items-center gap-3 px-4 py-2 border-b border-default shrink-0"
    >
      <span class="text-sm text-muted">{{ t('kanban.groupBy') }}</span>
      <USelectMenu
        v-model="activeGroupField"
        :items="fieldOptions"
        value-key="value"
        class="w-48"
        size="sm"
      />
    </div>

    <!-- Kanban columns container -->
    <div class="flex-1 overflow-x-auto overflow-y-hidden min-h-0">
      <div class="flex gap-4 p-4 h-full">
        <CroutonKanbanColumn
          v-for="column in groupedItems"
          :key="column.value ?? 'uncategorized'"
          :column-value="column.value"
          :label="column.label"
          :items="column.items"
          :collection="collection"
          :color="column.color"
          :icon="column.icon"
          :card-component="cardComponent"
          :show-count="showCounts"
          :is-drop-target="isDropTarget(column.value)"
          :show-collab-presence="showCollabPresence"
          @move="handleMove"
          @select="handleSelect"
          @drag-start="handleDragStart"
          @drag-end="handleDragEnd"
        />

        <!-- Empty state when no columns -->
        <div
          v-if="groupedItems.length === 0"
          class="flex items-center justify-center w-full min-h-64 text-muted"
        >
          <div class="text-center">
            <UIcon
              name="i-lucide-columns-3"
              class="w-12 h-12 mx-auto mb-4 opacity-50"
            />
            <p class="text-lg font-medium mb-2">
              {{ t('kanban.noItemsToDisplay') }}
            </p>
            <p class="text-sm">
              {{ t('kanban.addItemsOrChangeGrouping') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-board {
  /* Ensure full height in various containers */
  min-height: 400px;
}
</style>
