<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onBeforeUnmount, getCurrentInstance, resolveComponent, inject, type ComputedRef } from 'vue'
import type { Component } from 'vue'
import type { TreeNode as TreeNodeType } from './Tree.vue'
import type { CollabPresenceConfig } from '../types/table'
import type SortableType from 'sortablejs'
import type { SortableEvent, MoveEvent } from 'sortablejs'

const { t } = useT()
const { open } = useCrouton()

const treeDrag = useTreeDrag()
const { wasSaved } = useTreeItemState()

interface Props {
  item: TreeNodeType
  depth?: number
  labelKey?: string
  collection: string
  cardComponent?: Component | null
  /** Column identifier for cross-column drag detection */
  columnId?: string
  /** Whether nesting is allowed (false for sortable-only mode) */
  allowNesting?: boolean
  /** Show collaboration presence badges */
  showCollabPresence?: boolean | CollabPresenceConfig
  /** Hide the actions dropdown menu */
  hideActions?: boolean
  /** Show a hover "+" add button below each node */
  showAddButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0,
  labelKey: 'name',
  collection: '',
  cardComponent: null,
  columnId: '',
  allowNesting: true,
  showCollabPresence: false,
  hideActions: false,
  showAddButton: false
})

const emit = defineEmits<{
  move: [id: string, newParentId: string | null, newOrder: number, targetColumnId: string | null]
  select: [item: TreeNodeType]
  create: [parentId: string | null]
  createSibling: [siblingId: string]
}>()

// Refs
const childrenRef = ref<HTMLElement | null>(null)
let sortableInstance: SortableType | null = null

// Computed
const isGhost = computed(() => !!(props.item as any)._ghost)
const isExpanded = computed(() => treeDrag.isExpanded(props.item.id))
const isBeingDragged = computed(() => treeDrag.isDragging(props.item.id))
const isDropTarget = computed(() => treeDrag.isDropTarget(props.item.id))
const hasChildren = computed(() => (props.item.children?.length ?? 0) > 0)
const childCount = computed(() => props.item.children?.length ?? 0)

// Initialize/update expanded state reactively
// Auto-expands when an item gains children for the first time
watchEffect(() => {
  const count = childCount.value
  treeDrag.initExpanded(props.item.id, count > 0, count)
})

// Collapse when children become empty
watch(hasChildren, (has) => {
  if (!has && isExpanded.value) {
    treeDrag.setExpanded(props.item.id, false)
  }
})

// Flash animation state from global composable (triggered by useTreeMutation)
const { flashingCounts } = useTreeItemState()
const isCountFlashing = computed(() => !!flashingCounts.value[props.item.id])

// ============ Collab Presence Support ============

// Try to inject the resolved component from Collection.vue (preferred)
// This avoids issues with resolveComponent not finding auto-imported components
const injectedCollabComponent = inject<ComputedRef<Component | null> | null>('collabEditingBadgeComponent', null)

// Resolve CollabEditingBadge component if nuxt-crouton-collab is installed
// First tries inject, then falls back to resolveComponent
const collabEditingBadgeComponent = computed<Component | null>(() => {
  if (!props.showCollabPresence) {
    return null
  }

  // Use injected component from Collection.vue if available
  if (injectedCollabComponent?.value) {
    return injectedCollabComponent.value
  }

  // Fallback: Try to resolve the component directly
  try {
    const resolved = resolveComponent('CollabEditingBadge')
    if (typeof resolved !== 'string') {
      return resolved
    }

    // Try lazy variant
    const lazyResolved = resolveComponent('LazyCollabEditingBadge')
    if (typeof lazyResolved !== 'string') {
      return lazyResolved
    }
  } catch {
    // Component not available
  }

  return null
})

// Collab presence configuration
const collabConfig = computed<CollabPresenceConfig>(() => {
  if (typeof props.showCollabPresence === 'object') {
    return props.showCollabPresence
  }
  return {}
})

// Get room ID for this item
function getCollabRoomId(): string {
  if (collabConfig.value.getRoomId) {
    return collabConfig.value.getRoomId(props.item, props.collection)
  }
  // Default: {collection}-{id}
  return `${props.collection}-${props.item.id}`
}

// ============ UI Helpers ============

function getItemLabel(item: TreeNodeType): string {
  return item[props.labelKey] || item.name || item.title || item.label || item.id
}

function getStatusColor(status: string): 'primary' | 'warning' | 'error' | 'info' | 'neutral' {
  const statusColors: Record<string, 'primary' | 'warning' | 'error' | 'info' | 'neutral'> = {
    published: 'primary',
    active: 'primary',
    draft: 'warning',
    pending: 'warning',
    archived: 'neutral',
    deleted: 'error',
    error: 'error'
  }
  return statusColors[status?.toLowerCase()] || 'neutral'
}

function getAddActions(item: TreeNodeType) {
  return [
    [
      {
        label: t('tree.addChild'),
        icon: 'i-lucide-corner-down-right',
        onSelect: () => {
          console.log('[TreeNode] Add child page, parentId:', item.id)
          emit('create', item.id)
        }
      },
      {
        label: t('tree.addBelow'),
        icon: 'i-lucide-arrow-down',
        onSelect: () => {
          console.log('[TreeNode] Add page below, siblingId:', item.id)
          emit('createSibling', item.id)
        }
      }
    ]
  ]
}

function getItemActions(item: TreeNodeType) {
  return [
    [
      {
        label: t('common.edit'),
        icon: 'i-lucide-pencil',
        onSelect: () => open('update', props.collection, [item.id])
      }
    ],
    [
      {
        label: t('tree.moveUp'),
        icon: 'i-lucide-arrow-up',
        disabled: item.order === 0,
        onSelect: () => {
          if (item.order > 0) {
            // Menu actions stay in same column, so targetColumnId = current columnId or null
            emit('move', item.id, item.parentId, item.order - 1, props.columnId || null)
          }
        }
      },
      {
        label: t('tree.moveDown'),
        icon: 'i-lucide-arrow-down',
        onSelect: () => {
          emit('move', item.id, item.parentId, item.order + 1, props.columnId || null)
        }
      }
    ],
    [
      {
        label: t('tree.moveToRoot'),
        icon: 'i-lucide-corner-left-up',
        disabled: !item.parentId,
        onSelect: () => {
          if (item.parentId) {
            emit('move', item.id, null, 0, props.columnId || null)
          }
        }
      }
    ],
    [
      {
        label: t('common.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => open('delete', props.collection, [item.id])
      }
    ]
  ]
}

// ============ SortableJS Setup ============

async function initSortable() {
  if (!import.meta.client || !childrenRef.value) return

  // Destroy existing instance
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }

  try {
    const { default: Sortable } = await import('sortablejs')

    sortableInstance = new Sortable(childrenRef.value, {
      group: 'tree',
      animation: 150,
      fallbackOnBody: true,
      swapThreshold: 0.65,
      handle: '.drag-handle',
      ghostClass: 'tree-ghost',
      chosenClass: 'tree-chosen',
      dragClass: 'tree-drag',
      forceFallback: true,
      removeCloneOnHide: true,

      onStart: (evt: SortableEvent) => {
        const id = (evt.item as HTMLElement).dataset.id
        if (id) treeDrag.startDrag(id)
      },

      onEnd: (evt: SortableEvent) => {
        // Check if the move was blocked by onMove
        const wasBlocked = treeDrag.isMoveBlocked()

        treeDrag.endDrag()

        // If the move was blocked, don't emit
        if (wasBlocked) {
          return
        }

        // Only handle if this container is the source
        if (evt.from !== childrenRef.value) return

        const itemId = (evt.item as HTMLElement).dataset.id
        if (!itemId) return

        const toContainer = evt.to as HTMLElement
        const toParentId = toContainer.dataset.parentId
        const newIndex = evt.newIndex ?? 0

        // Find the target column ID by traversing up to find [data-column-id]
        const targetColumnEl = toContainer.closest('[data-column-id]') as HTMLElement | null
        const targetColumnId = targetColumnEl?.dataset.columnId || null

        emit('move', itemId, toParentId || null, newIndex, targetColumnId)
      },

      // Track drop target for line highlighting + auto-expand
      // Return false to prevent invalid drops (circular references)
      onMove: (evt: MoveEvent) => {
        const toContainer = evt.to as HTMLElement
        const targetParentId = toContainer.dataset.parentId

        // Block nesting when allowNesting is false (sortable-only mode)
        // Only allow moves to root level (empty parentId)
        if (!props.allowNesting && targetParentId) {
          treeDrag.setMoveBlocked(true)
          treeDrag.setDropTarget(null) // Clear highlight
          return false
        }

        // Prevent dropping an item into its own descendants
        const shouldBlock = treeDrag.isDescendantDrop(toContainer)

        // Track the block state for onEnd to check
        treeDrag.setMoveBlocked(shouldBlock)

        if (shouldBlock) {
          return false
        }

        const parentId = toContainer.dataset.parentId
        treeDrag.setDropTarget(parentId || null)

        // Schedule auto-expand for collapsed nodes (500ms delay in composable)
        const related = evt.related as HTMLElement
        const relatedNode = related.closest('[data-id]') as HTMLElement | null
        if (relatedNode?.dataset.id) {
          treeDrag.scheduleAutoExpand(relatedNode.dataset.id)
        }
        return true
      }
    })
  } catch (error) {
    console.warn('Sortable not available:', error)
  }
}

// ============ Lifecycle ============

// Show children container when expanded OR when dragging (for empty items)
// But only show empty dropzone if nesting is allowed
const showChildren = computed(() => {
  if (hasChildren.value) return isExpanded.value
  // Only show empty dropzone during drag if nesting is allowed
  return props.allowNesting && treeDrag.isDragging()
})

watch(showChildren, async (show) => {
  if (show) {
    await nextTick()
    initSortable()
  } else {
    sortableInstance?.destroy()
    sortableInstance = null
  }
})

onMounted(async () => {
  if (showChildren.value) {
    await nextTick()
    initSortable()
  }
})

onBeforeUnmount(() => {
  sortableInstance?.destroy()
  sortableInstance = null
  treeDrag.cancelAutoExpand(props.item.id)
})
</script>

<template>
  <div
    class="tree-node group/node"
    :data-id="item.id"
    :data-path="item.path"
    :data-depth="depth"
    :class="{ 'opacity-50': isBeingDragged, 'opacity-50 animate-pulse pointer-events-none': isGhost }"
  >
    <!-- Node content row -->
    <div
      class="tree-node-content group relative flex items-center gap-2 min-h-9 py-1.5 px-2 rounded-lg cursor-pointer overflow-hidden transition-colors hover:bg-white/5"
      :class="[]"
      @click="emit('select', item)"
    >
      <!-- Drag handle -->
      <div
        v-if="!isGhost"
        class="drag-handle cursor-grab opacity-40 group-hover:opacity-100 transition-opacity"
        @click.stop
      >
        <UIcon
          name="i-lucide-grip-vertical"
          class="size-4 text-muted"
        />
      </div>

      <!-- Child count / expand toggle -->
      <button
        v-if="hasChildren"
        class="shrink-0 flex items-center justify-center size-6 text-xs font-semibold tabular-nums rounded-full transition-colors duration-200"
        :class="[
          isCountFlashing
            ? 'count-pulse bg-primary text-primary-foreground'
            : 'bg-elevated text-muted hover:bg-accented hover:text-default'
        ]"
        @click.stop="treeDrag.toggle(item.id)"
      >
        {{ childCount }}
      </button>

      <!-- Custom card content OR default -->
      <template v-if="cardComponent">
        <component
          :is="cardComponent"
          :item="item"
          layout="tree"
          :collection="collection"
          class="flex-1 min-w-0"
        />
      </template>
      <template v-else>
        <!-- Item icon -->
        <UIcon
          v-if="item.icon"
          :name="item.icon"
          class="size-4 shrink-0 text-muted"
        />

        <!-- Item label -->
        <span class="truncate flex-1 text-sm font-medium">
          {{ getItemLabel(item) }}
        </span>

        <!-- Status badge -->
        <UBadge
          v-if="item.status"
          :color="getStatusColor(item.status)"
          size="sm"
          variant="subtle"
        >
          {{ item.status }}
        </UBadge>
      </template>

      <!-- Collab presence badge -->
      <component
        v-if="collabEditingBadgeComponent && item.id"
        :is="collabEditingBadgeComponent"
        :room-id="getCollabRoomId()"
        :room-type="collabConfig.roomType || collection"
        :current-user-id="collabConfig.currentUserId"
        :poll-interval="collabConfig.pollInterval || 5000"
        :show-self="collabConfig.showSelf"
        size="sm"
        variant="avatars"
        class="shrink-0"
      />

      <!-- Actions dropdown -->
      <div v-if="!hideActions && !isGhost" class="opacity-0 group-hover:opacity-100 transition-opacity">
        <UDropdownMenu
          :items="getItemActions(item)"
          :content="{ align: 'end' }"
        >
          <UButton
            icon="i-lucide-more-horizontal"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Actions"
            @click.stop
          />
        </UDropdownMenu>
      </div>

      <!-- Inline add dropdown (replaces full-width bar) -->
      <div v-if="showAddButton && !isGhost" class="opacity-0 group-hover:opacity-100 transition-opacity">
        <UDropdownMenu
          :items="getAddActions(item)"
          :content="{ align: 'end' }"
          :modal="false"
        >
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Add"
            @click.stop
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Children container (SortableJS target) -->
    <div
      v-if="showChildren"
      ref="childrenRef"
      class="tree-children mt-1 pl-3 gap-1 min-h-6 border-l-2 border-white/10 transition-colors duration-200 flex flex-col"
      style="margin-left: 1.7em"
      :class="[
        isDropTarget ? 'border-l-[var(--ui-primary)]' : '',
        !hasChildren ? 'min-h-2 !border-transparent' : ''
      ]"
      :data-parent-id="item.id"
    >
      <CroutonTreeNode
        v-for="child in item.children || []"
        :key="child.id"
        :item="child"
        :depth="depth + 1"
        :label-key="labelKey"
        :collection="collection"
        :card-component="cardComponent"
        :column-id="columnId"
        :allow-nesting="allowNesting"
        :show-collab-presence="showCollabPresence"
        :hide-actions="hideActions"
        :show-add-button="showAddButton"
        @move="(id: string, parentId: string | null, order: number, targetCol: string | null) => emit('move', id, parentId, order, targetCol)"
        @select="emit('select', $event)"
        @create="emit('create', $event)"
        @create-sibling="emit('createSibling', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
/* Child count pulse animation */
.count-pulse {
  animation: count-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
}

@keyframes count-pop {
  0% { transform: scale(1); box-shadow: 0 0 0 0 var(--ui-primary); }
  30% { transform: scale(1.4); }
  50% { transform: scale(0.9); box-shadow: 0 0 0 8px transparent; }
  70% { transform: scale(1.15); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
}
</style>
