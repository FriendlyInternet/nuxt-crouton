<script setup lang="ts">
/**
 * WorkspaceSidebar - Generic sidebar for workspace layout
 *
 * Shows a searchable list of collection items.
 * Uses CroutonTreeView for hierarchical collections, flat list otherwise.
 * Renders items using display config (title, subtitle, badge).
 */
import { type Component } from 'vue'

interface Props {
  collection: string
  selectedId?: string | null
  items?: any[]
  pending?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selectedId: null,
  items: () => [],
  pending: false
})

const emit = defineEmits<{
  'select': [item: any]
  'create': []
}>()

const { t } = useT()
const { tContent } = useT()

// Display config for resolving title/subtitle/badge
const display = useDisplayConfig(props.collection)
const { camelToTitleCase } = useFormatCollections()

// Collection config for hierarchy support
const { getConfig } = useCollections()
const collectionConfig = computed(() => getConfig(props.collection))
const isHierarchical = computed(() => collectionConfig.value?.hierarchy?.enabled)

// Search state
const searchQuery = ref('')
const searchInputRef = ref<{ inputRef?: { el?: HTMLElement } } | null>(null)

// Resolve title from item using display config + i18n
function getItemTitle(item: any): string {
  const titleField = display.title || 'title'
  // Try tContent for i18n-aware resolution
  const translated = tContent(item, titleField)
  if (translated) return translated
  // Fallback: try common fields
  return item.title || item.name || item.label || item.slug || item.id || t('common.untitled')
}

// Resolve subtitle from item
function getItemSubtitle(item: any): string | null {
  if (!display.subtitle) return null
  return tContent(item, display.subtitle) || item[display.subtitle] || null
}

// Resolve badge from item
function getItemBadge(item: any): string | null {
  if (!display.badge) return null
  return item[display.badge] ? String(item[display.badge]) : null
}

// Filter items by search
const filteredItems = computed(() => {
  if (!props.items) return []
  if (!searchQuery.value.trim()) return props.items

  const query = searchQuery.value.toLowerCase()
  return props.items.filter((item: any) => {
    const title = getItemTitle(item).toLowerCase()
    const subtitle = getItemSubtitle(item)?.toLowerCase() || ''
    return title.includes(query) || subtitle.includes(query)
  })
})

// Build tree structure for hierarchical collections
const treeItems = computed(() => {
  if (!isHierarchical.value) return []
  const items = filteredItems.value
  const parentField = collectionConfig.value?.hierarchy?.parentField || 'parentId'

  // When searching, show flat list
  if (searchQuery.value.trim()) {
    return items.map((item: any) => ({ ...item, children: [] }))
  }

  return buildTree(items, null, parentField)
})

function buildTree(items: any[], parentId: string | null, parentField: string): any[] {
  return items
    .filter((item: any) => item[parentField] === parentId)
    .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
    .map((item: any) => ({
      ...item,
      children: buildTree(items, item.id, parentField)
    }))
}

// Hierarchy config for tree
const hierarchyConfig = computed(() => {
  const config = collectionConfig.value?.hierarchy
  if (!config?.enabled) return { enabled: false }
  return {
    enabled: true,
    allowNesting: true,
    parentField: config.parentField || 'parentId',
    orderField: config.orderField || 'order'
  }
})

// Tree mutation for drag-drop
const treeMutation = isHierarchical.value ? useTreeMutation(props.collection) : null

async function handleTreeMove(id: string, newParentId: string | null, newOrder: number) {
  if (!treeMutation) return
  try {
    await treeMutation.moveNode(id, newParentId, newOrder)
  } catch {
    // Error handled by treeMutation with toast
  }
}

function handleSelect(item: any) {
  emit('select', item)
}

function handleCreate() {
  emit('create')
}

// Expose focus method for keyboard shortcuts
function focusSearch() {
  searchInputRef.value?.inputRef?.el?.focus()
}

defineExpose({ focusSearch })
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Search bar -->
    <div class="flex items-center gap-2 min-h-14 px-4 py-3 border-b border-default bg-elevated/30">
      <UInput
        ref="searchInputRef"
        v-model="searchQuery"
        icon="i-lucide-search"
        :placeholder="t('common.search') || 'Search...'"
        size="sm"
        class="flex-1"
      />
    </div>

    <!-- Loading -->
    <div v-if="pending" class="p-3 space-y-2">
      <USkeleton class="h-8 w-full" />
      <USkeleton class="h-8 w-full" />
      <USkeleton class="h-8 w-full" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!filteredItems.length"
      class="p-6 text-center text-muted flex-1"
    >
      <UIcon name="i-lucide-inbox" class="size-8 mb-2 opacity-50" />
      <p class="text-sm">
        {{ searchQuery ? t('common.noResults') : t('collection.noItemsYet') }}
      </p>
      <UButton
        v-if="!searchQuery"
        size="sm"
        color="primary"
        variant="soft"
        class="mt-3"
        @click="handleCreate"
      >
        {{ t('common.create') || 'Create' }}
      </UButton>
    </div>

    <!-- Tree view for hierarchical collections -->
    <div v-else-if="isHierarchical" class="flex-1 overflow-auto px-2">
      <CroutonTreeView
        :items="treeItems"
        :collection="collection"
        :hierarchy="hierarchyConfig"
        label-key="title"
        hide-actions
        @select="handleSelect"
        @move="handleTreeMove"
      />
    </div>

    <!-- Flat list for non-hierarchical collections -->
    <div v-else class="flex-1 overflow-auto">
      <ul role="list" class="divide-y divide-default">
        <li
          v-for="item in filteredItems"
          :key="item.id"
          class="px-4 py-3 cursor-pointer transition-colors"
          :class="[
            selectedId === item.id
              ? 'bg-primary/10 border-l-2 border-primary'
              : 'hover:bg-muted/50 border-l-2 border-transparent'
          ]"
          @click="handleSelect(item)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-default truncate">
                {{ getItemTitle(item) }}
              </p>
              <p
                v-if="getItemSubtitle(item)"
                class="text-xs text-muted truncate mt-0.5"
              >
                {{ getItemSubtitle(item) }}
              </p>
            </div>
            <UBadge
              v-if="getItemBadge(item)"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ getItemBadge(item) }}
            </UBadge>
          </div>
        </li>
      </ul>
    </div>

    <!-- Create button at bottom -->
    <div class="shrink-0 border-t border-default p-4">
      <UButton
        color="primary"
        variant="soft"
        size="sm"
        icon="i-lucide-plus"
        block
        @click="handleCreate"
      >
        {{ t('common.create') || 'Create' }}
      </UButton>
    </div>
  </div>
</template>
