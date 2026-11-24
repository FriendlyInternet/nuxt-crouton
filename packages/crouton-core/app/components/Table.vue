<template>
  <div
    :id="collection || 'crouton-table'"
    class="flex flex-col h-full"
  >
    <!-- Header slot -->
    <div
      v-if="$slots.header"
      class="shrink-0"
    >
      <slot name="header" />
    </div>

    <!-- Filters - fixed height (hidden in stateless mode) -->
    <div
      v-if="!stateless"
      class="flex items-center gap-2 shrink-0 px-4 py-3"
    >
      <CroutonTableSearch
        v-model="search"
        :placeholder="tString('table.search')"
        :debounce-ms="300"
        class="flex-1 min-w-0"
      />

      <CroutonTableActions
        :selected-rows="selectedRows"
        :collection="collection"
        :table="tableRef"
        class="shrink-0"
      />
    </div>

    <!-- Table container - scrollable -->
    <div class="relative flex-1 min-h-0 overflow-auto px-4">
      <!-- Loading overlay -->
      <div
        v-if="loadingPage"
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

      <UTable
        ref="tableRef"
        v-model:row-selection="rowSelection"
        v-model:sort="sort"
        v-model:column-visibility="columnVisibility"
        :data="slicedRows"
        :columns="allColumns as any"
        class="shrink-0"
        :class="{ 'opacity-50': loadingPage }"
        :ui="tableStyles"
      >
        <!-- Pass all slots from parent -->
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

        <!-- Default column templates -->
        <template #createdBy-cell="{ row }">
          <CroutonUsersCardMini
            v-if="row.original.createdByUser"
            :item="row.original.createdByUser"
            :name="true"
          />
        </template>

        <template #createdAt-cell="{ row }">
          <CroutonDate :date="row.original.createdAt" />
        </template>

        <template #updatedBy-cell="{ row }">
          <CroutonUsersCardMini
            v-if="row.original.updatedByUser"
            :item="row.original.updatedByUser"
            :name="true"
          />
        </template>

        <template #updatedAt-cell="{ row }">
          <CroutonDate :date="row.original.updatedAt" />
        </template>

        <template #presence-cell="{ row }">
          <component
            v-if="collabEditingBadgeComponent && row.original?.id"
            :is="collabEditingBadgeComponent"
            :room-id="getCollabRoomId(row.original)"
            :room-type="collabConfig.roomType || collection"
            :current-user-id="collabConfig.currentUserId"
            :poll-interval="collabConfig.pollInterval || 5000"
            :show-self="collabConfig.showSelf"
            size="sm"
            variant="avatars"
          />
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center gap-2">
            <CroutonItemButtonsMini
              delete
              update
              :disabled="stateless"
              :disabled-tooltip="stateless ? tString('table.previewOnly') : ''"
              @delete="openCrouton?.('delete', collection, [row.original.id])"
              @update="openCrouton?.('update', collection, [row.original.id])"
            />
          </div>
        </template>
      </UTable>
    </div>

    <!-- Pagination - fixed at bottom -->
    <div class="shrink-0 border-t border-default px-4">
      <CroutonTablePagination
        :page="page"
        :page-count="pageCount"
        :total-items="pageTotalToShow"
        :loading="loadingPage"
        @update:page="page = $event"
        @update:page-count="handlePageCountChange"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { resolveComponent, inject, type Component } from 'vue'
import type { TableProps, TableSort, PaginationData, SortableOptions, CollabPresenceConfig } from '../types/table'
import { CROUTON_ITEM_ACTION_KEY } from '../types/table'
import { useTableData } from '../composables/useTableData'
import { useTableColumns } from '../composables/useTableColumns'
import { useSortable } from '@vueuse/integrations/useSortable'

// Base row type for table data
interface CroutonBaseRow {
  id: string
  createdAt?: string
  updatedAt?: string
  createdBy?: string
  updatedBy?: string
  createdByUser?: { id: string, name?: string, image?: string }
  updatedByUser?: { id: string, name?: string, image?: string }
  [key: string]: unknown
}

// Props
const props = withDefaults(defineProps<TableProps>(), {
  columns: () => [],
  rows: () => [],
  collection: '',
  serverPagination: false,
  paginationData: null,
  refreshFn: undefined,
  sortable: false,
  stateless: false,
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

// Composables
const { t, tString } = useT()

// Item action: use provided handler (inline-aware) or fall back to crouton.open()
const itemAction = inject(CROUTON_ITEM_ACTION_KEY, undefined)

// Only use useCrouton when not in stateless mode
const croutonComposable = props.stateless ? null : useCrouton()
const openCrouton = itemAction
  ? (action: string, _collection: string, ids: string[]) => itemAction(action as any, ids)
  : croutonComposable?.open
const setPagination = croutonComposable?.setPagination ?? (() => {})
const getPagination = croutonComposable?.getPagination ?? (() => ({
  currentPage: 1,
  pageSize: 10,
  sortBy: 'createdAt',
  sortDirection: 'desc' as const,
  totalItems: 0,
  totalPages: 0
}))

// Refs
const tableRef = useTemplateRef<any>('tableRef')

// State
const loadingPage = ref(false)
const search = ref('')
const sort = ref<TableSort>({ column: 'createdAt', direction: 'desc' })
const page = ref(1)
const pageCount = ref(10)
const rowSelection = ref({})
const columnVisibility = ref<Record<string, boolean>>({ id: false })

// Server pagination data - cast to PaginationData type
const serverPaginationData = computed<PaginationData | null>(() => {
  if (!props.serverPagination) return null
  const data = props.paginationData || getPagination(props.collection)
  // Ensure totalItems has a default value
  return {
    currentPage: data.currentPage,
    pageSize: data.pageSize,
    totalItems: data.totalItems || 0,
    totalPages: data.totalPages,
    sortBy: data.sortBy,
    sortDirection: data.sortDirection
  }
})

// Initialize from server
if (serverPaginationData.value) {
  page.value = serverPaginationData.value.currentPage || 1
  pageCount.value = serverPaginationData.value.pageSize || 10
}

// Composable data
const { allColumns } = useTableColumns({
  columns: props.columns,
  hideDefaultColumns: props.hideDefaultColumns,
  sortable: props.sortable,
  showCollabPresence: !!props.showCollabPresence
})

const { slicedRows, pageTotalToShow } = useTableData({
  rows: toRef(props, 'rows'),
  search,
  sort,
  page,
  pageCount,
  serverPagination: props.serverPagination,
  paginationData: serverPaginationData.value
})

// Computed
const tableColumns = computed(() =>
  tableRef.value?.tableApi?.getAllColumns() || []
)

const selectedRows = computed(() =>
  tableRef.value?.tableApi?.getFilteredSelectedRowModel().rows.map((row: any) => row.original) || []
)

// Sortable configuration
const sortableEnabled = computed(() => !!props.sortable)
const sortableConfig = computed<SortableOptions>(() => {
  if (typeof props.sortable === 'object') return props.sortable
  return {}
})

// ============ Collab Presence Support ============

// Resolve CollabEditingBadge component if nuxt-crouton-collab is installed
const collabEditingBadgeComponent = computed<Component | null>(() => {
  if (!props.showCollabPresence) return null

  // Try to resolve the component - Nuxt auto-imports will work with resolveComponent
  const resolved = resolveComponent('CollabEditingBadge')
  if (typeof resolved !== 'string') return resolved

  // Try lazy variant
  const lazyResolved = resolveComponent('LazyCollabEditingBadge')
  if (typeof lazyResolved !== 'string') return lazyResolved

  return null
})

// Collab presence configuration
const collabConfig = computed<CollabPresenceConfig>(() => {
  if (typeof props.showCollabPresence === 'object') {
    return props.showCollabPresence
  }
  return {}
})

// Get room ID for a row
function getCollabRoomId(row: CroutonBaseRow): string {
  if (collabConfig.value.getRoomId) {
    return collabConfig.value.getRoomId(row, props.collection)
  }
  return `${props.collection}-${row.id}`
}

// Stable class name for tbody targeting (used by useSortable)
const sortableClass = `crouton-sortable-${props.collection || 'table'}`

const tableStyles = computed(() => ({
  base: 'table-fixed border-separate border-spacing-0',
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  tbody: `[&>tr]:last:[&>td]:border-b-0 ${sortableEnabled.value ? sortableClass : ''}`,
  th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
  td: 'border-b border-default'
}))

// Methods
async function fetchPage(newPage: number) {
  if (!props.serverPagination || !props.collection) return

  loadingPage.value = true
  try {
    setPagination(props.collection, {
      currentPage: newPage,
      pageSize: pageCount.value,
      sortBy: sort.value.column,
      sortDirection: sort.value.direction
    })

    if (props.refreshFn) {
      await props.refreshFn()
    } else {
      // Fallback: refresh the current team's cached lists of this collection
      await cacheKeys?.refreshLists()
    }
  } catch (error) {
    console.error('Error fetching page:', error)
  } finally {
    loadingPage.value = false
  }
}

function handlePageCountChange(newCount: number) {
  pageCount.value = newCount
  page.value = 1
}

// Watchers
watch(page, (newPage, oldPage) => {
  if (props.serverPagination && newPage !== oldPage) fetchPage(newPage)
})

watch(pageCount, (newCount, oldCount) => {
  if (props.serverPagination && newCount !== oldCount) fetchPage(1)
})

watch(sort, (newSort, oldSort) => {
  if (props.serverPagination
    && (newSort.column !== oldSort.column || newSort.direction !== oldSort.direction)) {
    page.value = 1
    fetchPage(1)
  }
}, { deep: true })

// Sortable drag-and-drop functionality
const reordering = ref(false)

// The one cache-key builder (#4506), used by the page-change fallback refresh
const cacheKeys = props.collection ? useCollectionCacheKeys(props.collection) : null

// Initialize useTreeMutation for reordering if collection is provided
const treeMutation = props.collection && sortableEnabled.value
  ? useTreeMutation(props.collection)
  : null

async function handleReorder(oldIndex: number, newIndex: number) {
  if (!treeMutation || reordering.value || oldIndex === newIndex) return

  reordering.value = true

  try {
    // Build updates array with new order values
    const currentRows = [...slicedRows.value]
    const [movedItem] = currentRows.splice(oldIndex, 1)
    currentRows.splice(newIndex, 0, movedItem)

    const updates = currentRows.map((row: any, index: number) => ({
      id: row.id,
      order: index
    }))

    await treeMutation.reorderSiblings(updates)
  } catch (error) {
    console.error('[Table] Reorder failed:', error)
    // Cache will be invalidated by useTreeMutation, triggering refresh
  } finally {
    reordering.value = false
  }
}

// Initialize sortable - useSortable handles DOM timing internally
if (sortableEnabled.value && import.meta.client) {
  const showHandle = sortableConfig.value.handle !== false

  useSortable(`.${sortableClass}`, slicedRows, {
    animation: sortableConfig.value.animation ?? 150,
    handle: showHandle ? '.drag-handle' : undefined,
    disabled: sortableConfig.value.disabled ?? false,
    ghostClass: 'opacity-50',
    chosenClass: 'bg-elevated',
    onEnd: (evt) => {
      if (evt.oldIndex !== undefined && evt.newIndex !== undefined) {
        handleReorder(evt.oldIndex, evt.newIndex)
      }
    }
  })
}
</script>
