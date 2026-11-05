<template>
  <div class="crouton-tree-layout">
    <!-- Header slot -->
    <slot name="header" />

    <div class="relative">
      <!-- Loading overlay -->
      <div
        v-if="loading"
        class="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-loader-2"
            class="animate-spin"
          />
          <span class="text-sm">{{ t('common.loading') }}</span>
        </div>
      </div>

      <!-- Tree content -->
      <div
        v-if="tree.length > 0"
        class="p-4"
      >
        <CroutonTreeView
          :key="treeKey"
          :items="tree"
          :collection="collection"
          :hierarchy="hierarchy"
          :card-component="cardComponent"
          :show-collab-presence="showCollabPresence"
          @move="handleMove"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!loading"
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
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { Component } from 'vue'
import type { HierarchyConfig, CollabPresenceConfig } from '../types/table'

const { t } = useT()

export interface TreeNode {
  id: string
  parentId: string | null
  path: string
  depth: number
  order: number
  children: TreeNode[]
  [key: string]: any
}

interface Props {
  rows: any[]
  collection: string
  hierarchy: HierarchyConfig
  loading?: boolean
  cardComponent?: Component | null
  /** Show collaboration presence badges on tree nodes */
  showCollabPresence?: boolean | CollabPresenceConfig
}

const props = withDefaults(defineProps<Props>(), {
  rows: () => [],
  hierarchy: () => ({ enabled: true }),
  loading: false,
  cardComponent: null,
  showCollabPresence: false
})

const emit = defineEmits<{
  move: [id: string, newParentId: string | null, newOrder: number]
}>()

/**
 * Build a tree structure from a flat array of items
 * Uses parentId and order fields to construct hierarchy
 */
function buildTree(items: any[]): TreeNode[] {
  const {
    parentField = 'parentId',
    orderField = 'order',
    pathField = 'path',
    depthField = 'depth'
  } = props.hierarchy

  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes with children arrays
  items.forEach((item) => {
    map.set(item.id, {
      ...item,
      parentId: item[parentField] ?? null,
      path: item[pathField] ?? '/',
      depth: item[depthField] ?? 0,
      order: item[orderField] ?? 0,
      children: []
    })
  })

  // Build hierarchy by assigning children to parents
  items.forEach((item) => {
    const node = map.get(item.id)!
    const parentId = item[parentField]

    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })

  // Sort by order at each level
  const sortByOrder = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.order - b.order || (a.id || '').localeCompare(b.id || ''))
    nodes.forEach(n => sortByOrder(n.children))
  }
  sortByOrder(roots)

  return roots
}

// Computed tree structure from flat rows
// Use a key based on row data to force reactivity
const treeKey = computed(() => props.rows.map(r => `${r.id}:${r.parentId}:${r.order}`).join(','))
const tree = computed(() => buildTree(props.rows))

// Handle move events from TreeView
// Only emit once - prefer the emit pattern over callback prop
function handleMove(id: string, newParentId: string | null, newOrder: number) {
  emit('move', id, newParentId, newOrder)
}
</script>
