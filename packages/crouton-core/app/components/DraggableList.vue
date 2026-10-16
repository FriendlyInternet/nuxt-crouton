<script setup lang="ts">
/**
 * CroutonDraggableList - A list of items that can be dragged into a flow
 *
 * Displays collection items in a simple list format where each item
 * can be dragged and dropped onto a CroutonFlow canvas.
 *
 * @example
 * ```vue
 * <CroutonDraggableList
 *   :items="options"
 *   collection="options"
 *   label-field="title"
 * />
 * ```
 */

interface Props {
  /** Array of items to display */
  items: Record<string, unknown>[]
  /** Collection name for drag data */
  collection: string
  /** Field to use as item label (default: 'title') */
  labelField?: string
  /** Field to use as item description (default: 'description') */
  descriptionField?: string
  /** Field to use as item icon (default: 'icon') */
  iconField?: string
  /** Whether to show a search filter */
  searchable?: boolean
  /** Placeholder for search input */
  searchPlaceholder?: string
  /** Whether items are loading */
  loading?: boolean
  /** Empty state message */
  emptyMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  labelField: 'title',
  descriptionField: 'description',
  iconField: 'icon',
  searchable: true,
  searchPlaceholder: undefined,
  loading: false,
  emptyMessage: undefined
})

const { t } = useT()

const emit = defineEmits<{
  /** Emitted when an item starts being dragged */
  dragStart: [item: Record<string, unknown>]
  /** Emitted when an item is clicked */
  itemClick: [item: Record<string, unknown>]
}>()

// Search filter
const search = ref('')

// Filtered items based on search
const filteredItems = computed(() => {
  if (!search.value.trim()) return props.items

  const query = search.value.toLowerCase()
  return props.items.filter((item) => {
    const label = String(item[props.labelField] || '').toLowerCase()
    const description = String(item[props.descriptionField] || '').toLowerCase()
    return label.includes(query) || description.includes(query)
  })
})

/**
 * Get the label for an item
 */
function getLabel(item: Record<string, unknown>): string {
  return String(item[props.labelField] || t('common.untitled'))
}

/**
 * Get the description for an item
 */
function getDescription(item: Record<string, unknown>): string | undefined {
  const desc = item[props.descriptionField]
  return desc ? String(desc) : undefined
}

/**
 * Get the icon for an item
 */
function getIcon(item: Record<string, unknown>): string | undefined {
  const icon = item[props.iconField]
  return icon ? String(icon) : undefined
}

/**
 * Handle drag start
 */
function handleDragStart(item: Record<string, unknown>) {
  emit('dragStart', item)
}

/**
 * Handle item click
 */
function handleItemClick(item: Record<string, unknown>) {
  emit('itemClick', item)
}
</script>

<template>
  <div class="crouton-draggable-list">
    <!-- Search -->
    <div
      v-if="searchable"
      class="crouton-draggable-list-search"
    >
      <UInput
        v-model="search"
        :placeholder="searchPlaceholder ?? t('draggableList.searchPlaceholder')"
        icon="i-lucide-search"
        size="sm"
      />
    </div>

    <!-- Loading state -->
    <div
      v-if="loading"
      class="crouton-draggable-list-loading"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin"
      />
      <span>{{ t('common.loading') }}</span>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="filteredItems.length === 0"
      class="crouton-draggable-list-empty"
    >
      <UIcon
        name="i-lucide-inbox"
        class="w-8 h-8 opacity-50"
      />
      <span>{{ emptyMessage ?? t('draggableList.empty') }}</span>
    </div>

    <!-- Items list -->
    <div
      v-else
      class="crouton-draggable-list-items"
    >
      <CroutonDraggableItem
        v-for="item in filteredItems"
        :key="String(item.id)"
        :item="item"
        :collection="collection"
        @drag-start="handleDragStart(item)"
      >
        <div
          class="crouton-draggable-list-item"
          @click="handleItemClick(item)"
        >
          <div
            v-if="getIcon(item)"
            class="crouton-draggable-list-item-icon"
          >
            <UIcon :name="getIcon(item)!" />
          </div>
          <div class="crouton-draggable-list-item-content">
            <span class="crouton-draggable-list-item-label">
              {{ getLabel(item) }}
            </span>
            <span
              v-if="getDescription(item)"
              class="crouton-draggable-list-item-description"
            >
              {{ getDescription(item) }}
            </span>
          </div>
          <div class="crouton-draggable-list-item-handle">
            <UIcon
              name="i-lucide-grip-vertical"
              class="opacity-40"
            />
          </div>
        </div>
      </CroutonDraggableItem>
    </div>

    <!-- Slot for custom footer -->
    <slot name="footer" />
  </div>
</template>

<style scoped>
.crouton-draggable-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
}

.crouton-draggable-list-search {
  flex-shrink: 0;
}

.crouton-draggable-list-loading,
.crouton-draggable-list-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--color-neutral-500);
  font-size: 0.875rem;
}

.crouton-draggable-list-items {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow-y: auto;
}

.crouton-draggable-list-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--color-neutral-50);
  border: 1px solid var(--color-neutral-200);
  border-radius: 0.5rem;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.dark .crouton-draggable-list-item {
  background: var(--color-neutral-900);
  border-color: var(--color-neutral-700);
}

.crouton-draggable-list-item:hover {
  background: var(--color-neutral-100);
  border-color: var(--color-neutral-300);
}

.dark .crouton-draggable-list-item:hover {
  background: var(--color-neutral-800);
  border-color: var(--color-neutral-600);
}

.crouton-draggable-list-item-icon {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary-100);
  color: var(--color-primary-600);
  border-radius: 0.375rem;
}

.dark .crouton-draggable-list-item-icon {
  background: var(--color-primary-900);
  color: var(--color-primary-400);
}

.crouton-draggable-list-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.crouton-draggable-list-item-label {
  font-weight: 500;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--color-neutral-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark .crouton-draggable-list-item-label {
  color: var(--color-neutral-100);
}

.crouton-draggable-list-item-description {
  font-size: 0.75rem;
  line-height: 1rem;
  color: var(--color-neutral-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.crouton-draggable-list-item-handle {
  flex-shrink: 0;
  cursor: grab;
}

.crouton-draggable-list-item-handle:active {
  cursor: grabbing;
}
</style>
