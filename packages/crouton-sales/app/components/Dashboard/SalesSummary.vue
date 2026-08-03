<script setup lang="ts">
/**
 * Live sales summary for the online dashboard (#179, epic #175).
 *
 * The "sales" half of the dashboard: headline numbers + a top-products list for
 * one event, read from the cloud D1 mirror via the existing team-scoped chart
 * aggregation endpoints (revenue-by-day, orders-by-status, top-products) — no
 * new server aggregation, just composition (KISS). Polls on a light cadence so
 * it tracks freshly-mirrored orders without the 2s churn of the orders list.
 *
 * Auto-imported as <SalesDashboardSalesSummary>. Mount inside a clientOnly,
 * team-members-only surface (the dashboard block) — the chart endpoints require
 * team membership.
 */
interface RevenueRow { date: string, revenue: number }
interface StatusRow { status: string, count: number }
interface ProductRow { product: string, quantity: number }
interface ChartResponse<T> { items: T[] }

const props = withDefaults(defineProps<{
  teamParam: string
  eventId: string
  /** Event currency for money formatting ('EUR' | 'USD'). */
  currency?: string | null
  /** Poll cadence for the summary numbers. */
  pollMs?: number
  /** Personnel (staff) order filter: exclude / only / all (default all). */
  personnel?: 'all' | 'exclude' | 'only'
}>(), {
  currency: 'EUR',
  pollMs: 15000,
})

const { t } = useT()
const { format } = useSalesCurrency(() => props.currency)

const revenueRows = ref<RevenueRow[]>([])
const outstanding = ref(0)
const statusRows = ref<StatusRow[]>([])
const productRows = ref<ProductRow[]>([])
const loaded = ref(false)

const base = computed(() => `/api/crouton-sales/teams/${props.teamParam}/charts`)
const query = computed(() => ({ eventId: props.eventId, personnel: props.personnel }))

/**
 * The backlog (#1763). Read from the orders endpoint rather than a chart
 * aggregate, so this tile and the orders pane below it can never disagree —
 * both render the same server-computed number. `pageSize=1` because we want the
 * count, not the rows.
 *
 * Best-effort on purpose: a failure here keeps the last value and must not
 * blank the revenue figures beside it.
 */
async function refreshOutstanding() {
  try {
    const orders = await $fetch<{ outstanding?: number }>(
      `/api/crouton-sales/teams/${props.teamParam}/events/${props.eventId}/orders`,
      { query: { pageSize: 1 } }
    )
    outstanding.value = Number(orders?.outstanding ?? 0)
  }
  catch { /* keep the last value */ }
}

async function fetchAll() {
  try {
    const [rev, status, top] = await Promise.all([
      $fetch<ChartResponse<RevenueRow>>(`${base.value}/revenue-by-day`, { query: query.value }),
      $fetch<ChartResponse<StatusRow>>(`${base.value}/orders-by-status`, { query: query.value }),
      $fetch<ChartResponse<ProductRow>>(`${base.value}/top-products`, { query: query.value }),
    ])
    revenueRows.value = rev.items ?? []
    statusRows.value = status.items ?? []

    await refreshOutstanding()
    productRows.value = top.items ?? []
  }
  catch {
    // Transient (e.g. brief auth/network blip) — keep the last good numbers.
  }
  finally {
    loaded.value = true
  }
}

const totalRevenue = computed(() => revenueRows.value.reduce((s, r) => s + (Number(r.revenue) || 0), 0))
const totalOrders = computed(() => statusRows.value.reduce((s, r) => s + (Number(r.count) || 0), 0))
const avgOrder = computed(() => (totalOrders.value > 0 ? totalRevenue.value / totalOrders.value : 0))
const topProducts = computed(() => productRows.value.slice(0, 5))
const maxQty = computed(() => Math.max(1, ...topProducts.value.map(p => Number(p.quantity) || 0)))

const stats = computed(() => [
  { key: 'revenue', label: t('sales.dashboard.revenue'), value: format(totalRevenue.value), icon: 'i-lucide-banknote' },
  { key: 'orders', label: t('sales.dashboard.orders'), value: String(totalOrders.value), icon: 'i-lucide-receipt' },
  { key: 'avg', label: t('sales.dashboard.avgOrder'), value: format(avgOrder.value), icon: 'i-lucide-trending-up' },
  {
    key: 'outstanding',
    label: t('sales.dashboard.outstanding'),
    value: String(outstanding.value),
    icon: outstanding.value > 0 ? 'i-lucide-hourglass' : 'i-lucide-check-check'
  },
])

onMounted(() => {
  fetchAll()
  useIntervalFn(fetchAll, props.pollMs)
})

// Refetch immediately when the personnel filter flips (don't wait for the poll).
watch(() => props.personnel, () => fetchAll())
</script>

<template>
  <div class="sales-dashboard-summary @container space-y-4">
    <!-- Headline numbers: always one row of three; the tile TYPOGRAPHY scales
         with the COMPONENT's width (@container), not the viewport — inside a
         narrow workspace pane full-size text would overflow the columns. -->
    <div class="grid grid-cols-2 @sm:grid-cols-4 gap-2 @sm:gap-3">
      <div
        v-for="s in stats"
        :key="s.key"
        class="min-w-0 rounded-2xl border border-default bg-elevated/40 p-2.5 @sm:p-4"
      >
        <div class="flex items-center gap-1.5 text-muted text-[10px] @sm:text-xs font-medium uppercase tracking-wide">
          <UIcon :name="s.icon" class="size-3.5 shrink-0 hidden @xs:block" />
          <span class="truncate">{{ s.label }}</span>
        </div>
        <div class="mt-1 text-base @sm:text-2xl font-semibold tabular-nums truncate">{{ s.value }}</div>
      </div>
    </div>

    <!-- Top products -->
    <div class="rounded-2xl border border-default bg-elevated/40 p-4">
      <div class="flex items-center gap-2 text-muted text-xs font-medium uppercase tracking-wide mb-3">
        <UIcon name="i-lucide-trophy" class="size-4" />
        {{ t('sales.dashboard.topProducts') }}
      </div>

      <p v-if="loaded && topProducts.length === 0" class="text-sm text-muted py-2">
        {{ t('sales.dashboard.noSalesYet') }}
      </p>

      <ul v-else class="space-y-2">
        <li v-for="p in topProducts" :key="p.product" class="flex items-center gap-3">
          <span class="w-32 shrink-0 truncate text-sm">{{ p.product }}</span>
          <span class="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500"
              :style="{ width: `${Math.round((Number(p.quantity) || 0) / maxQty * 100)}%` }"
            />
          </span>
          <span class="w-8 shrink-0 text-right text-sm font-medium tabular-nums">{{ p.quantity }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
