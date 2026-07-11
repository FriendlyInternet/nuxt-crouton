<script setup lang="ts">
const props = defineProps<{
  orderId: string
  remarks?: string
  /** This order's print queue rows (passed by OrdersTab, which owns the
   * event-wide query) — rendered as a per-printer detail list. */
  printJobs?: any[]
  /** Whether the event has active printers — keeps the Printers tab visible
   * (with an explanation) even when this order generated no tickets. */
  hasPrinters?: boolean
  /** Per-location remark text keyed by locationId (order.locationRemarks). */
  locationRemarks?: Record<string, string> | null
  /** Event locations — names the location remarks. */
  locations?: Array<{ id: string, title: string }>
}>()

// Requeue one failed print job, or hard-delete this whole order — both handled
// by OrdersTab, which owns the team/event context, the endpoints and the poll.
const emit = defineEmits<{
  retryJob: [jobId: string]
  deleteOrder: [orderId: string]
}>()

const { t } = useT()

const itemsQuery = computed(() => ({ orderId: props.orderId }))
const { items, pending } = await useCollectionQuery('salesOrderitems', { query: itemsQuery })

type OrderItemRow = {
  id: string
  quantity: number | string
  unitPrice: number
  totalPrice: number
  remarks?: string
  selectedOptions?: Record<string, unknown> | null
  productIdData?: { title?: string } | null
}

const rows = computed(() => (items.value as OrderItemRow[] | null) || [])

// Currency comes from OrdersTab via provide (it owns the event).
const { format: formatPrice } = useSalesCurrency()

const total = computed(() => rows.value.reduce((sum, r) => sum + (Number(r.totalPrice) || 0), 0))

// What a given print job actually printed — mirrors the server's grouping in
// generatePrintJobsForOrder: receipt jobs carry the whole order; kitchen jobs
// carry their location's items (product.locationId); a kitchen job WITHOUT a
// location is the synthetic "default" ticket and carries only the items that
// themselves have no location — NOT the whole order. One line per item.
function jobItems(job: any): string[] {
  const all = rows.value
  let subset: typeof all
  if (job?.printMode === 'kitchen' && !job?.locationId) {
    subset = all.filter(i => !(i.productIdData as any)?.locationId)
  }
  else if (job?.locationId) {
    subset = all.filter(i => (i.productIdData as any)?.locationId === job.locationId)
  }
  else {
    subset = all
  }
  return subset
    .map(i => `${i.quantity}× ${i.productIdData?.title || t('sales.orders.unknownProduct')}`)
}

// Order details and print jobs as tabs. The Printers tab shows whenever the
// event prints at all — an order without tickets still explains why instead
// of silently dropping the tab. Without printers the single tab list hides.
const tabs = computed(() => [
  { label: t('sales.orders.tabOrder', 'Order'), value: 'order', slot: 'order' as const },
  ...(props.printJobs?.length || props.hasPrinters
    ? [{ label: t('sales.orders.tabPrinters', 'Printers'), value: 'printers', slot: 'printers' as const }]
    : []),
])

// Selected options are stored as option ids — resolve each to its label via
// the joined product's options array (raw ids on screen help nobody), one
// line per option.
function optionLabels(item: OrderItemRow): string[] {
  const sel = item.selectedOptions
  if (!sel) return []
  const ids = Array.isArray(sel)
    ? sel
    : typeof sel === 'object'
      ? Object.values(sel)
      : [sel]
  const productOptions = (item.productIdData as any)?.options || []
  return ids
    .filter((id): id is string => Boolean(id))
    .map(id => productOptions.find((o: any) => o?.id === id)?.label || String(id))
}

// Location remarks with their location names, ready to render.
const namedLocationRemarks = computed(() => {
  const byId = new Map((props.locations || []).map(loc => [loc.id, loc.title]))
  return Object.entries(props.locationRemarks || {})
    .filter(([, text]) => text?.trim())
    .map(([locationId, text]) => ({
      locationId,
      title: byId.get(locationId) || locationId,
      text,
    }))
})
</script>

<template>
  <!-- Extra bottom padding sets the expanded ticket apart from the next row -->
  <div class="bg-elevated/30 px-4 pt-3 pb-10">
    <div v-if="pending" class="py-2 text-sm text-muted">
      {{ t('sales.workspace.loadingOrders') }}
    </div>
    <UTabs
      v-else
      :items="tabs"
      default-value="order"
      variant="link"
      size="sm"
      :ui="{ list: tabs.length > 1 ? '' : 'hidden' }"
    >
      <template #order>
        <div v-if="rows.length === 0" class="py-2 text-sm text-muted">
          {{ t('sales.orders.noItems') }}
        </div>
        <template v-else>
          <div v-if="props.remarks" class="mb-2 flex items-start gap-1.5 text-sm text-warning">
            <UIcon name="i-lucide-message-square" class="shrink-0 mt-0.5" />
            <span>{{ props.remarks }}</span>
          </div>
          <!-- Per-location remarks (printed as REMARK: on that location's ticket) -->
          <div
            v-for="remark in namedLocationRemarks"
            :key="remark.locationId"
            class="mb-2 flex items-start gap-1.5 text-sm text-warning"
          >
            <UIcon name="i-lucide-message-square" class="shrink-0 mt-0.5" />
            <span><span class="font-medium">{{ remark.title }}:</span> {{ remark.text }}</span>
          </div>
          <ul class="divide-y divide-default/60">
            <li v-for="item in rows" :key="item.id" class="flex items-start gap-3 py-2 text-sm">
              <span class="shrink-0 tabular-nums font-medium text-muted w-8">{{ item.quantity }}×</span>
              <div class="min-w-0 flex-1">
                <span class="font-medium">{{ item.productIdData?.title || t('sales.orders.unknownProduct') }}</span>
                <p v-for="(label, i) in optionLabels(item)" :key="i" class="text-xs text-muted truncate">
                  {{ label }}
                </p>
                <p v-if="item.remarks" class="text-xs text-warning truncate">
                  {{ item.remarks }}
                </p>
              </div>
              <span class="shrink-0 tabular-nums">{{ formatPrice(item.totalPrice) }}</span>
            </li>
          </ul>
          <div class="flex items-center justify-between border-t border-default mt-2 pt-2 text-sm font-semibold">
            <span>{{ t('sales.orders.total') }}</span>
            <span class="tabular-nums">{{ formatPrice(total) }}</span>
          </div>
        </template>
      </template>

      <template #printers>
        <p v-if="!printJobs?.length" class="py-2 text-sm text-muted">
          {{ t('sales.printQueue.noTicketForPrinter') }}
        </p>
        <ul v-else class="divide-y divide-default/60">
          <li v-for="job in printJobs" :key="job.id" class="py-2">
            <SalesPrintqueuesCard :item="job" stateless class="w-full">
              <!-- Icon-only re-print, left of the LED so the dot stays rightmost -->
              <template #actions>
                <UTooltip v-if="String(job.status ?? '') === '9'" :text="t('sales.orders.rePrint')">
                  <UButton
                    size="xs"
                    color="warning"
                    variant="soft"
                    icon="i-lucide-rotate-ccw"
                    square
                    class="shrink-0"
                    :aria-label="t('sales.orders.rePrint')"
                    @click="emit('retryJob', job.id)"
                  />
                </UTooltip>
              </template>
            </SalesPrintqueuesCard>
            <ul v-if="jobItems(job).length" class="text-xs text-muted mt-1 ps-7 space-y-0.5">
              <li v-for="(line, i) in jobItems(job)" :key="i">{{ line }}</li>
            </ul>
          </li>
        </ul>
      </template>
    </UTabs>

    <!-- Destructive footer action, below the totals and clear of the tab bar
         (#1517's whole-order Reprint lives up there). Two-step pill: arm →
         confirm hard-deletes the order + its items + its print jobs. -->
    <div v-if="!pending" class="mt-3 pt-3 border-t border-dashed border-default flex justify-end">
      <CroutonDeleteButton expanded @confirm="emit('deleteOrder', props.orderId)" />
    </div>
  </div>
</template>
