<script setup lang="ts">
/**
 * Order history slideover — the active user's own orders for this event.
 *
 * The volunteer/admin counterpart of the workspace "Bestellingen" pane: same
 * expandable-rows-with-items shape, but read from the helper-authed
 * `events/[eventId]/my-orders` endpoint (a helper token can't reach the
 * team-scoped OrdersTab endpoints). Filtered server-side to the signed-in
 * helper's own orders, so there are no filters and no reprint controls here
 * (volunteer reprint is deliberately out — it would ghost-print receipts).
 *
 * Mounted only while the slideover is open (v-if in OrderInterface), so the
 * poll runs only while visible; each open remounts fresh.
 */
const props = defineProps<{
  eventId: string
  /** Event currency ('EUR' | 'USD'), for price formatting. */
  currency?: string
}>()

defineEmits<{ close: [] }>()

const { t } = useT()
const { token } = useHelperAuth()
const { format: formatPrice } = useSalesCurrency(() => props.currency)

// Server-shaped by shapeMyOrders: items already carry a resolved productTitle +
// optionLabels, and the order its own total — no client-side assembly.
interface HistoryItem {
  id: string
  quantity: number | string
  totalPrice: number
  remarks?: string | null
  productTitle?: string | null
  optionLabels: string[]
}

interface HistoryOrder {
  id: string
  eventOrderNumber?: number | null
  clientName?: string | null
  overallRemarks?: string | null
  isPersonnel?: boolean | null
  status: string
  createdAt: string | number
  printStatus: 'none' | 'busy' | 'done' | 'failed'
  total: number
  items: HistoryItem[]
}

const orders = ref<HistoryOrder[]>([])
const pending = ref(true)
const loadError = ref(false)

async function loadOrders() {
  try {
    orders.value = await $fetch<HistoryOrder[]>(
      `/api/crouton-sales/events/${props.eventId}/my-orders`,
      { headers: token.value ? { 'x-scoped-token': token.value } : undefined }
    )
    loadError.value = false
  }
  catch {
    loadError.value = true
  }
  finally {
    pending.value = false
  }
}

// Light poll while open so a just-placed order's print LED settles (printing →
// done) without a manual refresh. Pause while the tab is hidden.
let refreshInterval: ReturnType<typeof setInterval> | null = null
function onVisibilityChange() {
  if (document.visibilityState === 'visible') loadOrders()
}
onMounted(() => {
  loadOrders()
  refreshInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    loadOrders()
  }, 4000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

const expandedIds = ref<Set<string>>(new Set())
function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

// Combined print-status LED, same palette as OrdersTab's order row. 'none' ⇒ no
// dot (event doesn't print, or this order generated no tickets).
function ledClass(status: HistoryOrder['printStatus']): string {
  switch (status) {
    case 'failed': return 'bg-error'
    case 'busy': return 'bg-warning animate-pulse'
    case 'done': return 'bg-success'
    default: return ''
  }
}
function ledLabel(status: HistoryOrder['printStatus']): string {
  switch (status) {
    case 'failed': return t('sales.printQueue.statusError', 'Error')
    case 'busy': return t('sales.printQueue.statusPrinting', 'Printing')
    case 'done': return t('sales.printQueue.statusDone', 'Done')
    default: return ''
  }
}

function orderTime(value: string | number): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

</script>

<!-- Template complexity is inherent v-if/v-for branching (load/error/empty states
     + order rows × expand × item/option loops) and not unit-testable; a packages/*
     .vue can't meet fallow's maxCrap 30, so this is baselined in
     .fallow-health-baseline.json exactly like the sibling OrdersTab/OrderItems. -->
<template>
  <div class="flex flex-col h-full min-h-0">
    <header class="flex items-center gap-2 px-4 h-14 border-b border-default shrink-0">
      <UIcon name="i-lucide-history" class="shrink-0 text-muted" />
      <h2 class="flex-1 min-w-0 font-semibold truncate">{{ t('sales.orderHistory.title') }}</h2>
      <UButton
        icon="i-lucide-x"
        size="sm"
        color="neutral"
        variant="ghost"
        :aria-label="t('sales.common.close')"
        @click="$emit('close')"
      />
    </header>

    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="pending && orders.length === 0" class="p-6 text-center text-muted">
        {{ t('sales.orderHistory.loading') }}
      </div>

      <UAlert
        v-else-if="loadError && orders.length === 0"
        color="error"
        variant="subtle"
        icon="i-lucide-alert-circle"
        :title="t('sales.orderHistory.loadError')"
        :actions="[{ label: t('sales.common.retry'), color: 'error', variant: 'soft', onClick: loadOrders }]"
      />

      <ul
        v-else-if="orders.length > 0"
        role="list"
        class="divide-y divide-default rounded-lg border border-default overflow-hidden"
      >
        <li
          v-for="order in orders"
          :key="order.id"
          class="bg-default"
          :class="order.isPersonnel ? 'border-s-2 border-s-warning' : ''"
        >
          <div
            class="group relative overflow-hidden hover:bg-elevated/50 transition-colors cursor-pointer"
            @click="toggleExpand(order.id)"
          >
            <div
              class="absolute left-0 top-0 bottom-0 z-10 flex items-center ps-3 transition-transform duration-200 ease-out"
              :class="expandedIds.has(order.id) ? 'translate-x-0' : '-translate-x-full group-hover:translate-x-0 pointer-coarse:translate-x-0'"
            >
              <UIcon
                name="i-lucide-chevron-right"
                class="shrink-0 text-dimmed transition-transform"
                :class="expandedIds.has(order.id) ? 'rotate-90' : ''"
              />
            </div>
            <div
              class="flex items-center gap-3 px-3 py-2.5"
              :class="expandedIds.has(order.id) ? 'ps-9' : 'group-hover:ps-9 pointer-coarse:ps-9'"
            >
              <span class="shrink-0 font-mono font-semibold tabular-nums text-muted">
                #{{ order.eventOrderNumber ?? '—' }}
              </span>
              <div class="min-w-0 flex-1">
                <span class="font-medium truncate">{{ order.clientName || t('sales.orders.client') }}</span>
                <p v-if="orderTime(order.createdAt)" class="text-xs text-muted tabular-nums">
                  {{ orderTime(order.createdAt) }}
                </p>
              </div>
              <span class="shrink-0 tabular-nums text-sm text-muted">{{ formatPrice(order.total) }}</span>
              <UTooltip v-if="order.printStatus !== 'none'" :text="ledLabel(order.printStatus)">
                <span class="block size-2.5 rounded-full shrink-0 transition-colors" :class="ledClass(order.printStatus)" />
              </UTooltip>
            </div>
          </div>

          <!-- Expanded: this order's line items (no reprint controls) -->
          <div v-if="expandedIds.has(order.id)" class="bg-elevated/30 px-4 pt-3 pb-6">
            <div v-if="order.overallRemarks" class="mb-2 flex items-start gap-1.5 text-sm text-warning">
              <UIcon name="i-lucide-message-square" class="shrink-0 mt-0.5" />
              <span>{{ order.overallRemarks }}</span>
            </div>
            <div v-if="order.items.length === 0" class="py-2 text-sm text-muted">
              {{ t('sales.orders.noItems') }}
            </div>
            <template v-else>
              <ul class="divide-y divide-default/60">
                <li v-for="item in order.items" :key="item.id" class="flex items-start gap-3 py-2 text-sm">
                  <span class="shrink-0 tabular-nums font-medium text-muted w-8">{{ item.quantity }}×</span>
                  <div class="min-w-0 flex-1">
                    <span class="font-medium">{{ item.productTitle || t('sales.orders.unknownProduct') }}</span>
                    <p v-for="(label, i) in item.optionLabels" :key="i" class="text-xs text-muted truncate">
                      {{ label }}
                    </p>
                    <p v-if="item.remarks" class="text-xs text-warning truncate">{{ item.remarks }}</p>
                  </div>
                  <span class="shrink-0 tabular-nums">{{ formatPrice(item.totalPrice) }}</span>
                </li>
              </ul>
              <div class="flex items-center justify-between border-t border-default mt-2 pt-2 text-sm font-semibold">
                <span>{{ t('sales.orders.total') }}</span>
                <span class="tabular-nums">{{ formatPrice(order.total) }}</span>
              </div>
            </template>
          </div>
        </li>
      </ul>

      <div v-else class="p-12 flex flex-col items-center justify-center gap-3 text-muted">
        <UIcon name="i-lucide-receipt" class="size-10 opacity-40" />
        <p class="text-sm">{{ t('sales.orderHistory.empty') }}</p>
      </div>
    </div>
  </div>
</template>
