<script setup lang="ts">
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
  /** Empty state message (defaults to the translated `events.log.empty`) */
  emptyMessage?: string
}>(), {
  pageSize: 50,
  showFilters: true,
  showPagination: true,
  emptyMessage: undefined
})

const emit = defineEmits<{
  eventClick: [event: CroutonEvent]
}>()

const { t } = useI18n()

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

// Reactive query: changing a filter or the page re-runs the fetch
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
    pageSize: props.pageSize
  }
}))

const { data, pending, error, refresh } = useCroutonEvents(queryOptions)
const events = computed(() => (data.value as CroutonEvent[] | null | undefined) || [])

// Back to the first page when a filter changes
watch(filters, () => {
  page.value = 1
}, { deep: true })

// The endpoint returns no total: show a next page only when this one is full
const total = computed(() =>
  (page.value - 1) * props.pageSize + events.value.length + (events.value.length === props.pageSize ? 1 : 0)
)

// Collections / people seen so far — kept across filter changes so the menus don't shrink
const seenCollections = ref<string[]>([])
const seenUsers = ref<Array<{ id: string, name: string }>>([])

watch(events, (list) => {
  const collections = new Set(seenCollections.value)
  const users = new Map(seenUsers.value.map(u => [u.id, u]))
  for (const e of list) {
    if (e.collectionName) collections.add(e.collectionName)
    if (e.userId && !users.has(e.userId)) {
      users.set(e.userId, { id: e.userId, name: e.userName || t('events.log.unknownUser') })
    }
  }
  seenCollections.value = Array.from(collections).sort()
  seenUsers.value = Array.from(users.values())
}, { immediate: true })

// Selected event for the detail modal
const selectedEvent = ref<CroutonEvent | null>(null)
const showDetail = ref(false)

function handleEventClick(event: CroutonEvent) {
  selectedEvent.value = event
  showDetail.value = true
  emit('eventClick', event)
}

// Export — triggered from the page navbar via the exposed exportAs()
const { exportToCSV, exportToJSON, exporting } = useCroutonEventsExport()

async function exportAs(format: 'csv' | 'json') {
  try {
    if (format === 'csv') await exportToCSV({ filters: filters.value })
    else await exportToJSON({ filters: filters.value })
  } catch (err) {
    console.error('Export failed:', err)
  }
}

// Phone: the page header's "Filtres" button opens the filters drawer and shows its count
const filtersRef = ref<{ openDrawer: () => void, activeFilterCount: number } | null>(null)
const activeFilterCount = computed(() => filtersRef.value?.activeFilterCount ?? 0)

function openFilters() {
  filtersRef.value?.openDrawer()
}

defineExpose({ refresh, exportAs, exporting, openFilters, activeFilterCount })
</script>

<template>
  <div class="crouton-activity-log flex flex-col gap-6">
    <CroutonActivityFilters
      v-if="showFilters"
      ref="filtersRef"
      v-model="filters"
      :collections="seenCollections"
      :users="seenUsers"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="t('events.log.error')"
      :description="error.message"
      :actions="[{ label: t('events.log.retry'), color: 'error', variant: 'outline', onClick: () => refresh() }]"
    />

    <CroutonActivityTimeline
      v-else
      :events="events"
      :loading="pending"
      :empty-message="emptyMessage"
      @event-click="handleEventClick"
    />

    <div
      v-if="showPagination && !error && total > pageSize"
      class="flex justify-center"
    >
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="pageSize"
        :sibling-count="1"
        size="sm"
      />
    </div>

    <CroutonEventDetail
      v-if="selectedEvent"
      v-model="showDetail"
      :event="selectedEvent"
    />
  </div>
</template>
