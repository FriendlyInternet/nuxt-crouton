<script lang="ts" setup>
import { ref, onMounted, nextTick, onBeforeUnmount } from 'vue'
import type { Component } from 'vue'
import type { HierarchyConfig, CollabPresenceConfig } from '../types/table'
import type { TreeNode } from './Tree.vue'
import type SortableType from 'sortablejs'
import type { SortableEvent, MoveEvent } from 'sortablejs'

const treeDrag = useTreeDrag()
const { t } = useT()

interface Props {
  items: TreeNode[]
  collection: string
  hierarchy: HierarchyConfig
  labelKey?: string
  cardComponent?: Component | null
  /** Unique identifier for this tree column (used for cross-column drag detection) */
  columnId?: string
  /** Show collaboration presence badges on tree nodes */
  showCollabPresence?: boolean | CollabPresenceConfig
  /** Hide the actions dropdown menu on tree nodes */
  hideActions?: boolean
  /** Show a hover "+" add button below each node */
  showAddButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  hierarchy: () => ({ enabled: true }),
  labelKey: 'name',
  cardComponent: null,
  columnId: '',
  showCollabPresence: false,
  hideActions: false,
  showAddButton: false
})

const emit = defineEmits<{
  move: [id: string, newParentId: string | null, newOrder: number, targetColumnId: string | null]
  select: [item: TreeNode]
  create: [parentId: string | null]
  createSibling: [siblingId: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
let sortableInstance: SortableType | null = null

async function initRootSortable() {
  if (!import.meta.client || !rootRef.value) return
  if (sortableInstance) return

  try {
    const { default: Sortable } = await import('sortablejs')

    sortableInstance = new Sortable(rootRef.value, {
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
        if (evt.from !== rootRef.value) return

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
        const allowNesting = props.hierarchy.allowNesting !== false
        if (!allowNesting && targetParentId) {
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

// Global dragend to ensure cleanup
function handleGlobalDragEnd() {
  treeDrag.endDrag()
}

onBeforeUnmount(() => {
  sortableInstance?.destroy()
  sortableInstance = null
  if (import.meta.client) {
    document.removeEventListener('dragend', handleGlobalDragEnd)
  }
})

onMounted(async () => {
  if (import.meta.client) {
    document.addEventListener('dragend', handleGlobalDragEnd)
  }
  await nextTick()
  initRootSortable()
})
</script>

<template>
  <ClientOnly>
    <div
      class="w-full"
      :data-column-id="columnId || undefined"
    >
      <div
        v-if="items.length > 0"
        ref="rootRef"
        class="min-h-12 pt-2 pb-16 flex flex-col gap-1"
        data-parent-id=""
      >
        <CroutonTreeNode
          v-for="item in items"
          :key="item.id"
          :item="item"
          :depth="0"
          :label-key="labelKey"
          :collection="collection"
          :card-component="cardComponent"
          :column-id="columnId"
          :allow-nesting="hierarchy.allowNesting !== false"
          :show-collab-presence="showCollabPresence"
          :hide-actions="hideActions"
          :show-add-button="showAddButton"
          @move="(id: string, parentId: string | null, order: number, targetCol: string | null) => emit('move', id, parentId, order, targetCol)"
          @select="emit('select', $event)"
          @create="emit('create', $event)"
          @create-sibling="emit('createSibling', $event)"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="text-center text-muted p-8"
      >
        <UIcon
          name="i-lucide-git-branch"
          class="w-12 h-12 mx-auto mb-4 opacity-50"
        />
        <p class="text-lg font-medium mb-2">
          {{ t('collection.noItemsYet') }}
        </p>
        <p class="text-sm">
          {{ t('tree.createFirstItem') }}
        </p>
      </div>
    </div>

    <template #fallback>
      <div class="w-full min-h-12 pt-2 pb-10">
        <USkeleton class="h-10 w-full mb-1" />
        <USkeleton class="h-10 w-full mb-1" />
        <USkeleton class="h-10 w-full" />
      </div>
    </template>
  </ClientOnly>
</template>

<style>
/* SortableJS dynamic classes - must be global (not scoped) */

/* Ghost = card-style placeholder showing where item will drop */
.tree-ghost {
  opacity: 0.5;
  border-radius: var(--ui-radius);
  background-color: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  margin: 0;
  padding: 0;
}

/* Hide children inside the ghost so only the node row shows */
.tree-ghost .tree-children,
.tree-ghost .tree-node {
  display: none;
}

/* Remove inner content styling so it doesn't double up with the ghost card */
.tree-ghost > .tree-node-content {
  background: transparent;
  border-radius: 0;
  border: none;
  box-shadow: none;
}

/* Drag = the element being dragged (follows cursor) */
.tree-drag {
  background-color: var(--ui-bg);
  box-shadow: 0 8px 20px -4px rgba(0, 0, 0, 0.25);
  opacity: 0.85;
}

/* Chosen = the original element that was picked up */
.tree-chosen {
  opacity: 0.4;
}
</style>
