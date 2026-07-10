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
 */
import { SALES_CHART_KINDS } from '../../utils/chart-blocks'
import type { SalesEvent } from '~~/layers/sales/collections/events/types'

const props = defineProps<{
  event: SalesEvent
  teamParam: string
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
const chartQuery = computed(() => ({ eventId: props.event.id }))
</script>

<template>
  <div class="space-y-4">
    <!-- Headline numbers + top products (polls, tracks fresh orders) -->
    <SalesDashboardSalesSummary
      :team-param="teamParam"
      :event-id="event.id"
      :currency="event.currency"
    />

    <!-- Revenue over time — only with the charts package installed -->
    <div v-if="hasCharts" class="rounded-2xl border border-default bg-elevated/40 p-4">
      <LazyCroutonChartsWidget
        :api-path="revenueKind.apiPath"
        :type="revenueKind.type"
        :x-field="revenueKind.xField"
        :y-fields="revenueKind.yFields"
        :title="t('sales.workspace.dataPanel.revenueChart')"
        :height="220"
        :query="chartQuery"
      />
    </div>

    <!-- Product × day pivot (Units ⇄ Revenue toggle + CSV export) — the block
         renderer reused as-is; it scopes via attrs.eventScope -->
    <div class="rounded-2xl border border-default bg-elevated/40 p-4">
      <SalesBlocksProductMatrixRender
        :attrs="{ eventScope: event.id, title: t('sales.workspace.dataPanel.productMatrix') }"
      />
    </div>
  </div>
</template>
