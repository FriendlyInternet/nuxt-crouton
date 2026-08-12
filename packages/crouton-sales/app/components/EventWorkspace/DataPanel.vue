<script setup lang="ts">
/**
 * Data panel: the event's key sales numbers beside the POS, so an admin can
 * watch sales without leaving the kassa. Deliberately a composition of the
 * existing "data" surfaces — the live sales summary (headline numbers + top
 * products, polling), the revenue-by-day chart, and the product × day matrix —
 * scoped to this event; no new aggregation (KISS).
 *
 * Rendered by the workspace Shell as a side pane (the "Data" vertical tab) —
 * the Shell owns the pane header and close button; this component is just the
 * pane body. Admin-only: the Shell only offers the tab to a real logged-in
 * member session (PIN helpers never see it), and the chart endpoints require
 * team membership anyway. Mounts fresh on every open (v-if).
 *
 * Filters (#2147): a single UChip+UButton+UCollapsible panel (same shape as
 * the Orders pane's filter panel, OrdersPaneBody.vue) folds product/category
 * selection AND the personnel toggle into one place. `filtersOpen` follows
 * the same controlled/standalone dance as OrdersPaneBody — the Shell owns the
 * toggle via the pane header when it binds v-model:filters-open.
 */
import { SALES_CHART_KINDS } from '../../utils/chart-blocks'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  event: SalesEvent
  teamParam: string
  /**
   * When provided, the filters toggle is owned by the parent (pane header)
   * and the internal Filters button is hidden. Bind via v-model:filters-open.
   */
  filtersOpen?: boolean
}>()

const emit = defineEmits<{
  'update:filtersOpen': [value: boolean]
  /** Active-filter count, for the parent's chip on its toggle button. */
  'update:activeFilterCount': [count: number]
}>()

const { t } = useT()

// The chart widget lives in the optional @fyit/crouton-charts package — when
// it isn't installed, drop the chart silently (the summary + matrix stand on
// their own; this isn't an editor surface that needs an install hint).
const { hasApp } = useCroutonApps()
const hasCharts = computed(() => hasApp('charts'))

// Same catalogue entry the salesChartBlock renders — the widget interpolates
// {teamId} in the apiPath itself; per-event scope goes as a query param.
const revenueKind = SALES_CHART_KINDS['revenue-by-day']!

// Controlled (pane header owns the toggle) vs standalone (own button) — same
// pattern as OrdersPaneBody.
const headerControlled = computed(() => props.filtersOpen !== undefined)
const internalFiltersOpen = ref(false)
const filtersOpen = computed<boolean>({
  get: () => headerControlled.value ? !!props.filtersOpen : internalFiltersOpen.value,
  set: v => headerControlled.value ? emit('update:filtersOpen', v) : (internalFiltersOpen.value = v)
})

// Product / category filter (#2146 threaded productIds/categoryIds through
// the backing endpoints) — ephemeral, not persisted, matching every other
// filter in this package.
const selectedProductIds = ref<string[]>([])
const selectedCategoryIds = ref<string[]>([])

const eventQuery = computed(() => ({ eventId: props.event.id }))
const { items: products } = await useCollectionQuery('salesProducts', { query: eventQuery })
const { items: categories } = await useCollectionQuery('salesCategories', { query: eventQuery })

const productOptions = computed(() =>
  (((products.value as { id: string, title: string }[] | null) || []))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(p => ({ id: p.id, label: p.title }))
)
const categoryOptions = computed(() =>
  (((categories.value as { id: string, title: string }[] | null) || []))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(c => ({ id: c.id, label: c.title }))
)

// Staff (personnel) orders skew the headline totals — default this pane to
// CUSTOMER sales only (exclude), with a toggle to fold staff back in. The
// dedicated personnel chart below always shows staff orders on their own.
const includePersonnel = ref(false)
const personnelMode = computed(() => includePersonnel.value ? 'all' : 'exclude')

const chartQuery = computed(() => ({
  eventId: props.event.id,
  personnel: personnelMode.value,
  productIds: selectedProductIds.value.join(','),
  categoryIds: selectedCategoryIds.value.join(',')
}))
const personnelChartQuery = computed(() => ({
  eventId: props.event.id,
  personnel: 'only',
  productIds: selectedProductIds.value.join(','),
  categoryIds: selectedCategoryIds.value.join(',')
}))

const activeFilterCount = computed(() =>
  [selectedProductIds.value.length > 0, selectedCategoryIds.value.length > 0, includePersonnel.value]
    .filter(Boolean).length
)
const hasActiveFilters = computed(() => activeFilterCount.value > 0)

watch(activeFilterCount, c => emit('update:activeFilterCount', c), { immediate: true })

function resetFilters() {
  selectedProductIds.value = []
  selectedCategoryIds.value = []
  includePersonnel.value = false
}

// Checkout (right beside this pane) emits the salesOrders mutation hook —
// remount the chart widget so it refetches; it has no refresh API of its own.
// The matrix below handles the same hook internally.
const chartRefreshKey = ref(0)
const unhookMutation = useNuxtApp().hook('crouton:mutation', (payload: any) => {
  if (payload.collection === 'salesOrders') chartRefreshKey.value++
})
onUnmounted(unhookMutation)
</script>

<template>
  <UCollapsible
    v-if="!headerControlled || filtersOpen"
    v-model:open="filtersOpen"
  >
    <UChip
      v-if="!headerControlled"
      :show="hasActiveFilters"
      :text="activeFilterCount"
      size="xl"
      inset
    >
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
      <CroutonSubBar
        class="p-2 px-4"
        sticky
        auto-hide
        flush
        :class="headerControlled ? '' : 'mt-2'"
      >
        <div class="w-full space-y-2">
          <div class="grid grid-cols-1 gap-2 @md:grid-cols-2">
            <USelectMenu
              v-model="selectedProductIds"
              :items="productOptions"
              value-key="id"
              multiple
              :placeholder="t('sales.workspace.allProducts')"
              icon="i-lucide-package"
              size="sm"
              class="w-full"
              :searchable="true"
            />
            <USelectMenu
              v-model="selectedCategoryIds"
              :items="categoryOptions"
              value-key="id"
              multiple
              :placeholder="t('sales.workspace.allCategories')"
              icon="i-lucide-tag"
              size="sm"
              class="w-full"
              :searchable="true"
            />
          </div>
          <USwitch
            v-model="includePersonnel"
            :label="t('sales.workspace.dataPanel.includePersonnel')"
          />
          <div
            v-if="hasActiveFilters"
            class="flex justify-end"
          >
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
      </CroutonSubBar>
    </template>
  </UCollapsible>
  <div class="space-y-4 p-4">
    <!-- Headline numbers + top products (polls, tracks fresh orders) -->
    <SalesDashboardSalesSummary
      :team-param="teamParam"
      :event-id="event.id"
      :currency="event.currency"
      :personnel="personnelMode"
      :product-ids="selectedProductIds"
      :category-ids="selectedCategoryIds"
    />

    <!-- Revenue over time — only with the charts package installed. Keyed by
         the personnel mode too so toggling refetches (the widget has no refresh
         API of its own; a key change remounts it). -->
    <div v-if="hasCharts" class="rounded-2xl border border-default bg-elevated/40 p-4">
      <LazyCroutonChartsWidget
        :key="`${chartRefreshKey}-${personnelMode}-${selectedProductIds.join(',')}-${selectedCategoryIds.join(',')}`"
        :api-path="revenueKind.apiPath"
        :type="revenueKind.type"
        :x-field="revenueKind.xField"
        :y-fields="revenueKind.yFields"
        :title="t('sales.workspace.dataPanel.revenueChart')"
        :height="220"
        :query="chartQuery"
      />
    </div>

    <!-- Personnel orders on their own — watch staff consumption regardless of
         the toggle above (always personnel-only) -->
    <div v-if="hasCharts && personnelMode === 'all'" class="rounded-2xl border border-default bg-elevated/40 p-4">
      <LazyCroutonChartsWidget
        :key="`${chartRefreshKey}-${selectedProductIds.join(',')}-${selectedCategoryIds.join(',')}`"
        :api-path="revenueKind.apiPath"
        :type="revenueKind.type"
        :x-field="revenueKind.xField"
        :y-fields="revenueKind.yFields"
        :title="t('sales.workspace.dataPanel.personnelChart')"
        :height="220"
        :query="personnelChartQuery"
      />
    </div>

    <!-- Per product: sold + still to deliver (#1867). Sits directly under the
         summary because it answers the standing mid-event question ("do we need
         to order more of this?") — the charts below are for looking back. -->
    <SalesDashboardPerProductTotals
      :team-param="teamParam"
      :event-id="event.id"
      :personnel="personnelMode"
      :product-ids="selectedProductIds"
      :category-ids="selectedCategoryIds"
    />

    <!-- Product × day pivot (Units ⇄ Revenue toggle + CSV export) — the block
         renderer reused as-is; it scopes via attrs.eventScope -->
    <div class="rounded-2xl border border-default bg-elevated/40 p-4">
      <SalesBlocksProductMatrixRender
        :attrs="{
          eventScope: event.id,
          personnel: personnelMode,
          productIds: selectedProductIds,
          categoryIds: selectedCategoryIds,
          title: t('sales.workspace.dataPanel.productMatrix')
        }"
      />
    </div>
  </div>
</template>
