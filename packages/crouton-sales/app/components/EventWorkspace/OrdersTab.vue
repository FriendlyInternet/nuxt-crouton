<script setup lang="ts">
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  event: SalesEvent
  /** When provided, the filters toggle is owned by the parent (pane header)
   *  and the internal Filters button is hidden. Bind via v-model:filters-open. */
  filtersOpen?: boolean
}>()

const emit = defineEmits<{
  'update:filtersOpen': [value: boolean]
  /** Active-filter count, for the parent's chip on its toggle button. */
  'update:activeFilterCount': [count: number]
}>()

// Share the event currency with the expandable OrderItems panels.
provideSalesCurrency(() => props.event.currency)

const { t } = useT()
const route = useRoute()
const teamParam = computed(() => route.params.team as string)

interface ActiveHelper {
  id: string
  displayName: string
  role: string
  expiresAt: string
  lastActiveAt: string | null
}

const { data: activeHelpers } = await useFetch<ActiveHelper[]>(
  () => `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/active-helpers`,
  { default: () => [] }
)

// Controlled (pane header owns the toggle) vs standalone (own button).
const headerControlled = computed(() => props.filtersOpen !== undefined)
const internalFiltersOpen = ref(false)
const filtersOpen = computed<boolean>({
  get: () => headerControlled.value ? !!props.filtersOpen : internalFiltersOpen.value,
  set: v => headerControlled.value ? emit('update:filtersOpen', v) : (internalFiltersOpen.value = v)
})

const selectedHelperName = ref<string | null>(null)
const selectedClientId = ref<string | null>(null)
const selectedPrinterId = ref<string | null>(null)
const selectedPrintStatus = ref<string | null>(null)

// All filters apply server-side — the list is paginated, so client-side
// filtering would miss matches on other pages. Printer filters go through
// an EXISTS over the order's print jobs.
const ordersQuery = computed(() => {
  const q: Record<string, string> = { eventId: props.event.id }
  if (selectedHelperName.value) q.owner = selectedHelperName.value
  if (selectedClientId.value) q.clientId = selectedClientId.value
  if (selectedPrinterId.value) q.printerId = selectedPrinterId.value
  if (selectedPrintStatus.value) q.printStatus = selectedPrintStatus.value
  return q
})

// Server pagination: events run into hundreds of orders, and this view polls
// every 2s — fetch only the newest page (server orders by createdAt desc).
const {
  items: orders,
  pending: ordersPending,
  refresh: refreshOrders,
  page: ordersPage,
  pageCount: ordersPageCount
} = await useCollectionQuery(
  'salesOrders',
  { query: ordersQuery, watch: true, pagination: { pageSize: 25 } }
)

// Filter change ⇒ back to page 1 (the old page may not exist in the new set).
watch([selectedHelperName, selectedClientId, selectedPrinterId, selectedPrintStatus], () => {
  ordersPage.value = 1
})

// Client filter only when the event requires clients — loose orders carry no
// clientId, so the filter would be meaningless there.
const clientFilterEnabled = computed(() => !!props.event.requiresClient)

const { items: clients } = await useCollectionQuery('salesClients')

// Printer LEDs: one dot per active event printer on every order row (the
// dedicated Printers tab is gone — per-order print status lives here now).
const { items: printers } = await useCollectionQuery(
  'salesPrinters',
  { query: computed(() => ({ eventId: props.event.id })) }
)

// Location titles — names the per-location remarks in the expanded order.
const { items: locations } = await useCollectionQuery(
  'salesLocations',
  { query: computed(() => ({ eventId: props.event.id })) }
)
type PrinterRow = { id: string, title: string, isActive?: boolean }
type PrintJobRow = {
  id: string
  orderId: string
  printerId: string
  status?: string | number
  locationId?: string | null
  printMode?: string | null
  errorMessage?: string
  retryCount?: number
  createdAt?: string | number
  completedAt?: string | number
  printerIdData?: { title: string }
}

// Slim status endpoint instead of the generated collection GET: that one
// returns each job's full base64 printData, which is far too heavy for the
// register's 2s poll. This payload is ~50 bytes per job.
const { data: printJobs, refresh: refreshPrintJobs } = await useFetch<PrintJobRow[]>(
  () => `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/status`,
  { default: () => [] }
)

const printerList = computed(() =>
  (((printers.value as PrinterRow[] | null) || []).filter(p => p.isActive !== false))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
)

// All event printers (incl. inactive — old jobs may reference them). The slim
// status endpoint ships only printerId, so jobs are enriched with the title
// here; without it PrintqueuesCard falls back to a generic "Printer" label.
const printerTitleById = computed(() => new Map(
  (((printers.value as PrinterRow[] | null) || [])).map(p => [p.id, p.title])
))

const jobsByOrder = computed(() => {
  const map = new Map<string, PrintJobRow[]>()
  for (const rawJob of ((printJobs.value as PrintJobRow[] | null) || [])) {
    const title = printerTitleById.value.get(rawJob.printerId)
    const job = title ? { ...rawJob, printerIdData: { title } } : rawJob
    const list = map.get(job.orderId)
    if (list) list.push(job)
    else map.set(job.orderId, [job])
  }
  return map
})

// Jobs for one order × printer (popover detail list).
function printerJobs(orderId: string, printerId: string) {
  return (jobsByOrder.value.get(orderId) || []).filter(j => j.printerId === printerId)
}

// Popover breakdown rows: only printers that actually got a ticket for this
// order — derived from the jobs (not printerList) so inactive printers with
// old jobs still show up. Printers without a ticket are simply irrelevant here.
function popoverPrinters(orderId: string) {
  const rows = new Map<string, { id: string, title: string }>()
  for (const job of (jobsByOrder.value.get(orderId) || [])) {
    if (rows.has(job.printerId)) continue
    rows.set(job.printerId, {
      id: job.printerId,
      title: job.printerIdData?.title || t('sales.printQueue.printer', 'Printer')
    })
  }
  return [...rows.values()].sort((a, b) => a.title.localeCompare(b.title))
}

// Per-line retry on a failed job (OrderItems emits the job id). The refresh
// flips the line to Pending immediately; the spooler picks it up on its poll.
const retryNotify = useNotify()
async function retryPrintJob(jobId: string) {
  try {
    await $fetch(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/retry-failed`,
      { method: 'POST', body: { jobId } }
    )
    await refreshPrintJobs()
  }
  catch {
    retryNotify.error(t('sales.printQueue.resendError', 'Could not requeue print jobs'))
  }
}

// Whole-order Reprint (OrderItems emits the orderId). Same team-authed endpoint,
// keyed by { orderId }: it resets the order's existing done/failed jobs back to
// pending so the transport re-drains them. Refresh flips the LEDs to Printing.
async function reprintOrder(orderId: string) {
  try {
    await $fetch(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/printqueues/retry-failed`,
      { method: 'POST', body: { orderId } }
    )
    await refreshPrintJobs()
    retryNotify.success(t('sales.orders.reprintQueued', 'Reprint queued'))
  }
  catch {
    retryNotify.error(t('sales.orders.reprintError', 'Could not reprint this order'))
  }
}

// Hard-delete one order (team-admin endpoint cascades to its items + print
// jobs). Fire the salesOrders crouton:mutation so every listener refreshes —
// notably the POS client picker's tab totals — then refresh this list + the
// print-queue poll and drop the (now-gone) row from the expanded set.
const nuxtApp = useNuxtApp()
async function deleteOrder(orderId: string) {
  try {
    await $fetch(
      `/api/crouton-sales/teams/${teamParam.value}/events/${props.event.id}/orders/${orderId}`,
      { method: 'DELETE' }
    )
    await nuxtApp.hooks.callHook('crouton:mutation', {
      operation: 'delete',
      collection: 'salesOrders',
      itemIds: [orderId],
      timestamp: Date.now()
    })
    if (expandedIds.value.has(orderId)) {
      const next = new Set(expandedIds.value)
      next.delete(orderId)
      expandedIds.value = next
    }
    await Promise.all([refreshOrders(), refreshPrintJobs()])
  }
  catch {
    retryNotify.error(t('sales.orders.deleteError', 'Could not delete order'))
  }
}

// Combined worst status across a set of jobs (status enum: 0=pending,
// 1=printing, 2=done, 9=error). Red wins, then orange (busy), then green;
// no jobs at all ⇒ grey.
function ledFromStatuses(statuses: string[]) {
  if (!statuses.length) {
    return { class: 'bg-accented', label: t('sales.printQueue.noTicket', 'No ticket') }
  }
  if (statuses.includes('9')) {
    return { class: 'bg-error', label: t('sales.printQueue.statusError', 'Error') }
  }
  if (statuses.some(s => s === '0' || s === '1')) {
    return { class: 'bg-warning animate-pulse', label: t('sales.printQueue.statusPrinting', 'Printing') }
  }
  return { class: 'bg-success', label: t('sales.printQueue.statusDone', 'Done') }
}

// One LED per order row, across every printer's jobs.
function orderLed(orderId: string) {
  return ledFromStatuses((jobsByOrder.value.get(orderId) || []).map(j => String(j.status ?? '0')))
}

// One LED per printer inside the popover breakdown.
function printerLed(orderId: string, printerId: string) {
  return ledFromStatuses(printerJobs(orderId, printerId).map(j => String(j.status ?? '0')))
}

// Latest job time for a printer's breakdown row.
function printerTime(orderId: string, printerId: string): string {
  const jobs = printerJobs(orderId, printerId)
  if (!jobs.length) return ''
  const latest = jobs.reduce((a, b) =>
    new Date(b.completedAt || b.createdAt || 0).getTime() >= new Date(a.completedAt || a.createdAt || 0).getTime() ? b : a)
  return jobTime(latest)
}

// Spooler error messages are stored in English; translate the known set.
function jobError(job: PrintJobRow): string {
  const raw = job.errorMessage || ''
  const key = printErrorKey(raw)
  return key ? t(key, raw) : raw
}

function jobTime(job: any): string {
  const v = job?.completedAt || job?.createdAt
  if (!v) return ''
  const d = new Date(v)
  // 24h clock — matches the printed ticket times.
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

const helperOptions = computed(() => [
  { id: null, label: t('sales.workspace.allHelpers') },
  ...((activeHelpers.value as ActiveHelper[] | null) || []).map(h => ({
    id: h.displayName,
    label: h.displayName
  }))
])

const clientOptions = computed(() => [
  { id: null, label: t('sales.workspace.allClients') },
  ...(((clients.value as { id: string, title: string }[] | null) || [])
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(c => ({ id: c.id, label: c.title })))
])

const printerOptions = computed(() => [
  { id: null, label: t('sales.workspace.allPrinters') },
  ...printerList.value.map(p => ({ id: p.id, label: p.title }))
])

// Buckets, not raw job statuses: busy folds pending+printing together — the
// register cares about "still coming out" vs "done" vs "needs attention".
const printStatusOptions = computed(() => [
  { id: null, label: t('sales.workspace.allPrintStatuses') },
  { id: 'busy', label: t('sales.workspace.printBusy') },
  { id: 'done', label: t('sales.printQueue.statusDone', 'Done') },
  { id: 'failed', label: t('sales.printQueue.statusError', 'Error') }
])

const activeFilterCount = computed(() =>
  [selectedHelperName.value, selectedClientId.value, selectedPrinterId.value, selectedPrintStatus.value]
    .filter(Boolean).length
)
const hasActiveFilters = computed(() => activeFilterCount.value > 0)

watch(activeFilterCount, c => emit('update:activeFilterCount', c), { immediate: true })

function resetFilters() {
  selectedHelperName.value = null
  selectedClientId.value = null
  selectedPrinterId.value = null
  selectedPrintStatus.value = null
}

// Register overview: always live, no toggle. Poll every 5s while the screen
// is visible — orders arrive from other helpers' devices, so the view must
// keep refreshing even when this register is idle. Pause while the browser
// tab is hidden and catch up the moment it becomes visible again.
function refreshAll() {
  refreshOrders()
  refreshPrintJobs()
}

let refreshInterval: ReturnType<typeof setInterval> | null = null

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshAll()
}

onMounted(() => {
  refreshInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return
    refreshAll()
  }, 2000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  if (refreshInterval) clearInterval(refreshInterval)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

type OrderRow = {
  id: string
  eventOrderNumber?: number
  clientName?: string
  overallRemarks?: string
  locationRemarks?: Record<string, string> | null
  isPersonnel?: boolean
  status: string
  owner?: string
}

const orderRows = computed(() => (orders.value as OrderRow[] | null) || [])

const expandedIds = ref<Set<string>>(new Set())

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

</script>

<template>
  <div class="space-y-4 @container">
    <!-- Filters live behind a toggle (in the pane header when the parent
         controls it); the chip marks a collapsed-but-active filter so a
         filtered list is never mistaken for the full one. When header-
         controlled and closed, render nothing — no stray space-y gap. -->
    <UCollapsible v-if="!headerControlled || filtersOpen" v-model:open="filtersOpen">
      <UChip v-if="!headerControlled" :show="hasActiveFilters" :text="activeFilterCount" size="xl" inset>
        <UButton
          :label="t('sales.workspace.filters')"
          icon="i-lucide-filter"
          :trailing-icon="filtersOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="outline"
          size="xs"
        />
      </UChip>
      <template #content>
        <!-- One filter per row — the selects stack in a single column so each
             (helper / client / printer / status) reads on its own line. -->
        <div class="rounded-lg bg-elevated/60 border border-default p-3 space-y-2" :class="headerControlled ? '' : 'mt-2'">
          <div class="grid grid-cols-1 gap-2">
            <USelectMenu
              v-model="selectedHelperName"
              :items="helperOptions"
              value-key="id"
              :placeholder="t('sales.workspace.allHelpers')"
              icon="i-lucide-user"
              size="sm"
              class="w-full"
              :searchable="true"
            />
            <USelectMenu
              v-if="clientFilterEnabled"
              v-model="selectedClientId"
              :items="clientOptions"
              value-key="id"
              :placeholder="t('sales.workspace.allClients')"
              icon="i-lucide-users"
              size="sm"
              class="w-full"
              :searchable="true"
            />
            <USelectMenu
              v-if="printerList.length"
              v-model="selectedPrinterId"
              :items="printerOptions"
              value-key="id"
              :placeholder="t('sales.workspace.allPrinters')"
              icon="i-lucide-printer"
              size="sm"
              class="w-full"
            />
            <USelectMenu
              v-if="printerList.length"
              v-model="selectedPrintStatus"
              :items="printStatusOptions"
              value-key="id"
              :placeholder="t('sales.workspace.allPrintStatuses')"
              icon="i-lucide-circle-dot"
              size="sm"
              class="w-full"
            />
          </div>
          <div v-if="hasActiveFilters" class="flex justify-end">
            <UButton
              :label="t('sales.workspace.resetFilters')"
              icon="i-lucide-rotate-ccw"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="resetFilters"
            />
          </div>
        </div>
      </template>
    </UCollapsible>
    <!-- Loading state only before first data — the 5s poll flips `pending`
         on every refresh and would otherwise flicker the whole list. -->
    <div v-if="ordersPending && orderRows.length === 0" class="p-6 text-center text-muted">
      {{ t('sales.workspace.loadingOrders') }}
    </div>
    <ul
      v-else-if="orderRows.length > 0"
      role="list"
      class="divide-y divide-default rounded-lg border border-default overflow-hidden"
    >
      <li
        v-for="order in orderRows"
        :key="order.id"
        class="bg-default"
        :class="order.isPersonnel ? 'border-s-2 border-s-warning' : ''"
      >
        <div
          class="group relative overflow-hidden hover:bg-elevated/50 transition-colors cursor-pointer"
          @click="toggleExpand(order.id)"
        >
          <!-- Expand chevron slides in from the left edge (stays out while
               the row is expanded), pushing the content inward — same
               affordance pattern as the POS product cards. -->
          <div
            class="absolute left-0 top-0 bottom-0 z-10 flex items-center ps-3
                   transition-transform duration-200 ease-out"
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
          <!-- Staff orders: warning edge bar on the row (li), no badge -->
          <span class="shrink-0 font-mono font-semibold tabular-nums text-muted">
            #{{ order.eventOrderNumber ?? '—' }}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium truncate">{{ order.clientName || t('sales.orders.client') }}</span>
            </div>
            <p v-if="order.owner" class="text-xs text-muted truncate flex items-center gap-1">
              <UIcon name="i-lucide-user" class="shrink-0" />
              {{ order.owner }}
            </p>
          </div>
          <!-- One LED per order: the combined worst status across all printers
               (red wins, then orange, then green; grey = no tickets at all).
               Hover popover breaks it down per printer. -->
          <div v-if="printerList.length" class="shrink-0 flex items-center" @click.stop>
            <UPopover mode="hover" :open-delay="150">
              <span
                class="block size-2.5 rounded-full transition-colors"
                :class="orderLed(order.id).class"
              />
              <template #content>
                <div class="p-3 space-y-3 min-w-52 max-w-72">
                  <div v-for="printer in popoverPrinters(order.id)" :key="printer.id" class="space-y-1">
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm font-semibold flex items-center gap-1.5 min-w-0">
                        <UTooltip :text="printerLed(order.id, printer.id).label">
                          <span
                            class="size-2 rounded-full shrink-0 transition-colors"
                            :class="printerLed(order.id, printer.id).class"
                          />
                        </UTooltip>
                        <UIcon name="i-lucide-printer" class="shrink-0 text-muted" />
                        <span class="truncate">{{ printer.title }}</span>
                      </p>
                      <span v-if="printerTime(order.id, printer.id)" class="text-xs text-dimmed tabular-nums">
                        {{ printerTime(order.id, printer.id) }}
                      </span>
                    </div>
                    <template v-for="job in printerJobs(order.id, printer.id)" :key="job.id">
                      <p v-if="String(job.status ?? '') === '9' && job.errorMessage" class="text-xs text-error">
                        {{ jobError(job) }}
                      </p>
                    </template>
                  </div>
                  <!-- Order generated no tickets at all (grey LED): explain once -->
                  <p v-if="!popoverPrinters(order.id).length" class="text-xs text-muted">
                    {{ t('sales.printQueue.noTicketForPrinter') }}
                  </p>
                </div>
              </template>
            </UPopover>
          </div>
          </div>
        </div>
        <SalesEventWorkspaceOrderItems
          v-if="expandedIds.has(order.id)"
          :order-id="order.id"
          :remarks="order.overallRemarks"
          :location-remarks="order.locationRemarks"
          :locations="locations || []"
          :print-jobs="jobsByOrder.get(order.id) || []"
          :has-printers="printerList.length > 0"
          @retry-job="retryPrintJob"
          @reprint-order="reprintOrder"
          @delete-order="deleteOrder"
        />
      </li>
    </ul>
    <!-- Same empty-state styling as the cart's "empty" block (Client/Cart.vue) -->
    <div v-else class="p-12 flex flex-col items-center justify-center gap-3 text-muted">
      <UIcon name="i-lucide-receipt" class="size-10 opacity-40" />
      <p class="text-sm">{{ hasActiveFilters ? t('sales.workspace.noOrdersFiltered') : t('sales.workspace.noOrders') }}</p>
    </div>
    <!-- Older orders: newest page is the register's working set; history on demand -->
    <div v-if="ordersPageCount > 1" class="flex items-center justify-center gap-3 pt-1">
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-left"
        :disabled="ordersPage <= 1"
        @click="ordersPage--"
      />
      <span class="text-xs text-muted tabular-nums">{{ ordersPage }} / {{ ordersPageCount }}</span>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-lucide-chevron-right"
        :disabled="ordersPage >= ordersPageCount"
        @click="ordersPage++"
      />
    </div>
  </div>
</template>
