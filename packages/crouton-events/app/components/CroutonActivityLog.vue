<script setup lang="ts">
import { useToggle } from '@vueuse/core'
import type { CroutonEvent, FilterState } from '../types/events'

const props = withDefaults(defineProps<{
  /** Filter to specific collection */
  collection?: string
  /** Filter to specific user */
  userId?: string
  /** Page size */
  pageSize?: number
  /** Show filters bar */
  showFilters?: boolean
  /** Show pagination */
  showPagination?: boolean
  /** Empty state message */
  emptyMessage?: string
}>(), {
  pageSize: 50,
  showFilters: true,
  showPagination: true,
  emptyMessage: 'No activity found'
})

const emit = defineEmits<{
  eventClick: [event: CroutonEvent]
}>()

// Filter state
const filters = ref<FilterState>({
  collectionName: props.collection || undefined,
  operation: undefined,
  userId: props.userId || undefined,
  dateFrom: undefined,
  dateTo: undefined
})

// Pagination
const page = ref(1)
const pageSize = ref(props.pageSize)

// Build query options
const queryOptions = computed(() => ({
  filters: {
    collectionName: filters.value.collectionName || undefined,
    operation: filters.value.operation || undefined,
    userId: filters.value.userId || undefined,
    dateFrom: filters.value.dateFrom,
    dateTo: filters.value.dateTo
  },
  pagination: {
    page: page.value,
    pageSize: pageSize.value
  }
}))

// Fetch events using the existing composable
const { data: events, pending, error, refresh } = useCroutonEvents(queryOptions.value)

// Watch for filter changes and refetch
watch(filters, () => {
  page.value = 1 // Reset to first page on filter change
  refresh()
}, { deep: true })

watch(page, () => {
  refresh()
})

// Get unique collections from events for filter dropdown
const availableCollections = computed(() => {
  if (!events.value) return []
  const collections = new Set(events.value.map((e: CroutonEvent) => e.collectionName))
  return Array.from(collections).sort()
})

// Get unique users from events for filter dropdown
const availableUsers = computed(() => {
  if (!events.value) return []
  const usersMap = new Map<string, { id: string, name: string }>()
  events.value.forEach((e: CroutonEvent) => {
    if (e.userId && !usersMap.has(e.userId)) {
      usersMap.set(e.userId, { id: e.userId, name: e.userName || 'Unknown' })
    }
  })
  return Array.from(usersMap.values())
})

// Selected event for detail modal
const selectedEvent = ref<CroutonEvent | null>(null)
const [showDetail, toggleShowDetail] = useToggle(false)

function handleEventClick(event: CroutonEvent) {
  selectedEvent.value = event
  showDetail.value = true
  emit('eventClick', event)
}

// Export functionality
const { exportToCSV, exportToJSON, exporting } = useCroutonEventsExport()

async function handleExportCSV() {
  try {
    await exportToCSV({ filters: filters.value })
  } catch (err) {
    console.error('Export failed:', err)
  }
}

async function handleExportJSON() {
  try {
    await exportToJSON({ filters: filters.value })
  } catch (err) {
    console.error('Export failed:', err)
  }
}

// Stats
const stats = computed(() => {
  if (!events.value) return { total: 0, creates: 0, updates: 0, deletes: 0 }
  const evts = events.value as CroutonEvent[]
  return {
    total: evts.length,
    creates: evts.filter(e => e.operation === 'create').length,
    updates: evts.filter(e => e.operation === 'update').length,
    deletes: evts.filter(e => e.operation === 'delete').length
  }
})
</script>

<template>
  <div class="crouton-activity-log space-y-4">
    <!-- Header with stats -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h2 class="text-lg font-semibold">
          Activity Log
        </h2>
        <div class="flex items-center gap-2 text-sm text-muted">
          <span>{{ stats.total }} events</span>
          <span class="text-green-500">+{{ stats.creates }}</span>
          <span class="text-blue-500">~{{ stats.updates }}</span>
          <span class="text-red-500">-{{ stats.deletes }}</span>
        </div>
      </div>

      <!-- Export buttons -->
      <div class="flex items-center gap-2">
        <UDropdownMenu
          :items="[
            [
              { label: 'Export as CSV', icon: 'i-lucide-file-spreadsheet', onSelect: handleExportCSV },
              { label: 'Export as JSON', icon: 'i-lucide-file-json', onSelect: handleExportJSON }
            ]
          ]"
        >
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            :loading="exporting"
          >
            <UIcon
              name="i-lucide-download"
              class="size-4 mr-1"
            />
            Export
          </UButton>
        </UDropdownMenu>
      </div>
    </div>

    <!-- Filters -->
    <CroutonActivityFilters
      v-if="showFilters"
      v-model="filters"
      :collections="availableCollections"
      :users="availableUsers"
      @refresh="refresh"
    />

    <!-- Error state -->
    <div
      v-if="error"
      class="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 p-4"
    >
      <div class="flex items-center gap-2 text-red-600 dark:text-red-400">
        <UIcon
          name="i-lucide-alert-circle"
          class="size-5"
        />
        <span>Failed to load activity: {{ error.message }}</span>
      </div>
      <UButton
        color="error"
        variant="ghost"
        size="sm"
        class="mt-2"
        @click="() => refresh()"
      >
        Try Again
      </UButton>
    </div>

    <!-- Timeline -->
    <CroutonActivityTimeline
      v-else
      :events="(events as CroutonEvent[]) || []"
      :loading="pending"
      :empty-message="emptyMessage"
      @event-click="handleEventClick"
    />

    <!-- Pagination -->
    <div
      v-if="showPagination && events?.length"
      class="flex items-center justify-between border-t pt-4"
    >
      <div class="text-sm text-muted">
        Showing {{ (page - 1) * pageSize + 1 }} - {{ Math.min(page * pageSize, stats.total) }} of {{ stats.total }}
      </div>
      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="page <= 1"
          @click="page--"
        >
          <UIcon
            name="i-lucide-chevron-left"
            class="size-4"
          />
          Previous
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="events && events.length < pageSize"
          @click="page++"
        >
          Next
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4"
          />
        </UButton>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <CroutonEventDetail
      v-if="selectedEvent"
      v-model="showDetail"
      :event="selectedEvent"
    />
  </div>
</template>
