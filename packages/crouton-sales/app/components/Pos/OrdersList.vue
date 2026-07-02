<template>
  <div class="space-y-6 p-6">
    <!-- Header with auto-refresh toggle -->
    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-semibold">{{ t('sales.orders.title') }}</h2>
      <div class="flex items-center gap-3">
        <span class="text-sm text-muted">{{ t('sales.orders.autoRefresh') }}</span>
        <USwitch v-model="autoRefresh" :aria-label="t('sales.orders.autoRefresh')" />
      </div>
    </div>

    <!-- Status filter tabs -->
    <UTabs v-model="activeTab" :items="tabItems" />

    <!-- Orders table -->
    <UTable
      :data="filteredOrders"
      :columns="columns"
      :loading="pending"
      :ui="{
        th: 'py-3.5 px-4',
        td: 'py-4 px-4'
      }"
    >
      <template #eventOrderNumber-cell="{ row }">
        <span class="font-mono text-base font-medium">#{{ row.original.eventOrderNumber || '—' }}</span>
      </template>

      <template #clientName-cell="{ row }">
        <span class="text-base">{{ row.original.clientName || '—' }}</span>
      </template>

      <template #status-cell="{ row }">
        <UBadge :color="getStatusColor(row.original.status)" :label="getStatusLabel(row.original.status)" size="md" />
      </template>

      <template #createdAt-cell="{ row }">
        <span class="text-base">{{ formatDate(row.original.createdAt) }}</span>
      </template>

      <template #actions-cell="{ row }">
        <div class="flex gap-2 justify-end">
          <UButton
            v-if="showReprint && row.original.status === 'print_failed'"
            :label="t('sales.orders.rePrint')"
            size="sm"
            color="warning"
            variant="soft"
            icon="i-lucide-printer"
            :loading="reprintingId === row.original.id"
            @click="reprint(row.original)"
          />
        </div>
      </template>
    </UTable>

    <!-- Empty state -->
    <div v-if="filteredOrders.length === 0 && !pending" class="text-center py-12 text-muted">
      {{ t('sales.orders.noOrdersFound') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SalesOrder } from '../../types'

const props = withDefaults(defineProps<{
  /** Event ID to filter orders (optional) */
  eventId?: string
  /** Collection name for orders query (defaults to 'salesOrders') */
  collectionName?: string
  /** Whether to show reprint button for failed orders */
  showReprint?: boolean
  /** API base path for print endpoint */
  printApiBasePath?: string
  /** Auto-refresh interval in ms (defaults to 10000) */
  refreshInterval?: number
}>(), {
  collectionName: 'salesOrders',
  showReprint: false,
  printApiBasePath: '/api/pos/events',
  refreshInterval: 10000,
})

const notify = useNotify()
const { t } = useT()

// Build query based on eventId prop. Returns {} (not undefined) when unscoped so
// it satisfies CollectionQueryOptions.query (Record<string, any>); the composable
// treats an empty query the same as none.
const query = computed(() => props.eventId ? { eventId: props.eventId } : {})

// Fetch orders
const { items: orders, pending, refresh } = await useCollectionQuery(props.collectionName, {
  query,
})

// Auto-refresh
const autoRefresh = ref(false)
let refreshIntervalId: ReturnType<typeof setInterval> | null = null

watch(autoRefresh, (enabled) => {
  if (enabled) {
    refreshIntervalId = setInterval(() => {
      refresh()
    }, props.refreshInterval)
  }
  else if (refreshIntervalId) {
    clearInterval(refreshIntervalId)
    refreshIntervalId = null
  }
})

onUnmounted(() => {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId)
  }
})

// Status filter tabs
const activeTab = ref('all')

const statusCounts = computed(() => {
  const orderList = (orders.value || []) as SalesOrder[]
  return {
    all: orderList.length,
    pending: orderList.filter(o => o.status === 'pending').length,
    processing: orderList.filter(o => o.status === 'processing').length,
    completed: orderList.filter(o => o.status === 'completed').length,
    cancelled: orderList.filter(o => o.status === 'cancelled').length,
  }
})

const tabItems = computed(() => [
  { label: `${t('sales.categories.all')} (${statusCounts.value.all})`, value: 'all' },
  { label: `${t('sales.orders.pending')} (${statusCounts.value.pending})`, value: 'pending' },
  { label: `${t('sales.orders.processing')} (${statusCounts.value.processing})`, value: 'processing' },
  { label: `${t('sales.orders.completed')} (${statusCounts.value.completed})`, value: 'completed' },
  { label: `${t('sales.orders.cancelled')} (${statusCounts.value.cancelled})`, value: 'cancelled' },
])

const filteredOrders = computed(() => {
  const orderList = (orders.value || []) as SalesOrder[]
  if (activeTab.value === 'all') return orderList
  return orderList.filter(o => o.status === activeTab.value)
})

// Table columns
const columns = computed<TableColumn<SalesOrder>[]>(() => [
  { accessorKey: 'eventOrderNumber', header: t('sales.orders.orderNumber') },
  { accessorKey: 'clientName', header: t('sales.orders.client') },
  { accessorKey: 'status', header: t('sales.orders.status') },
  { accessorKey: 'createdAt', header: t('sales.orders.createdAt') },
  { id: 'actions', header: '' },
])

// Status colors
function getStatusColor(status: string) {
  switch (status) {
    case 'pending': return 'warning'
    case 'processing': return 'info'
    case 'completed': return 'success'
    case 'cancelled': return 'error'
    case 'print_failed': return 'error'
    default: return 'neutral'
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'pending': return t('sales.orders.pending', 'Pending')
    case 'processing': return t('sales.orders.processing', 'Processing')
    case 'completed': return t('sales.orders.completed', 'Completed')
    case 'cancelled': return t('sales.orders.cancelled', 'Cancelled')
    case 'print_failed': return t('sales.orders.printFailed', 'Print failed')
    default: return status
  }
}

// Date formatting
function formatDate(date: Date | string | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleString()
}

// Re-print functionality
const reprintingId = ref<string | null>(null)

async function reprint(order: SalesOrder) {
  reprintingId.value = order.id
  try {
    await $fetch(`${props.printApiBasePath}/${order.eventId}/orders/${order.id}/print`, {
      method: 'POST',
    })
    notify.success(t('sales.orders.printTriggered'), { description: `Order #${order.eventOrderNumber} sent to print queue` })
    refresh()
  }
  catch (error) {
    notify.error(t('sales.orders.printFailed'), { description: t('sales.orders.printError') })
  }
  finally {
    reprintingId.value = null
  }
}
</script>
