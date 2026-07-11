<script setup lang="ts">
/**
 * CroutonChartsWidget
 *
 * Collection-driven chart component. Fetches collection data via useCollectionChart
 * and renders it using nuxt-charts (BarChart, LineChart, AreaChart, DonutChart).
 *
 * Auto-detects numeric fields when yFields is not provided.
 *
 * vue-chrts API summary:
 *   BarChart   – yAxis: string[] (required), categories: Record<string, {name,color}>, xFormatter
 *   AreaChart  – categories: Record<string, {name,color}>, xFormatter, stacked
 *   LineChart  – same as AreaChart (minus hideArea)
 *   DonutChart – data: number[], radius: number (required), categories: Record<string, {name,color}>
 */
interface Props {
  /** Collection key (e.g. 'blogPosts', 'products') */
  collection?: string
  /** Direct API path override. Supports {teamId} placeholder. Takes priority over collection. */
  apiPath?: string
  /** Chart type to render */
  type?: 'bar' | 'line' | 'area' | 'donut'
  /** Field to use as X axis. Auto-resolved from collection display.title if not set. */
  xField?: string
  /** Comma-separated field names for Y axis values. Auto-detected if not set. */
  yFields?: string
  /** Optional title above the chart */
  title?: string
  /** Chart height in pixels */
  height?: number
  /** Stack series (bar/area charts) */
  stacked?: boolean
  /** Chart orientation */
  orientation?: 'vertical' | 'horizontal'
  /** Extra query params forwarded to the data endpoint (e.g. { eventId } to scope an aggregation). */
  query?: Record<string, string | number>
}

const props = withDefaults(defineProps<Props>(), {
  collection: '',
  type: 'bar',
  height: 300,
  stacked: false,
  orientation: 'vertical'
})

// Parse comma-separated yFields string into array
const yFieldsArray = computed(() => {
  if (!props.yFields) return undefined
  return props.yFields.split(',').map(f => f.trim()).filter(Boolean)
})

const { chartData, categories, pending, error } = useCollectionChart(
  computed(() => props.collection || ''),
  computed(() => ({
    xField: props.xField,
    yFields: yFieldsArray.value,
    apiPath: props.apiPath,
    query: props.query,
    limit: 100
  }))
)

// Only show chart when there's data AND categories are configured (prevents "yAxis is required" crash)
const hasData = computed(() => chartData.value.length > 0 && categories.value.length > 0)

// xAxisKey: the non-category field used as the X axis label source
const xAxisKey = computed(() => {
  if (!hasData.value) return 'name'
  const categoryNames = categories.value.map((c) => c.name)
  const keys = Object.keys(chartData.value[0] || {})
  return keys.find(k => !categoryNames.includes(k)) || 'name'
})

// vue-chrts expects categories as Record<string, {name, color}> (keys = field names)
const categoriesObject = computed(() =>
  Object.fromEntries(categories.value.map((c) => [c.name, { name: c.name, color: c.color }]))
)

// yAxis field names array for BarChart
const yAxisNames = computed(() => categories.value.map((c) => c.name))

// xFormatter for BarChart / AreaChart / LineChart: map array index → actual x-field value
const xFormatter = computed(() => {
  const xKey = xAxisKey.value
  return (_: number, i = 0) => String(chartData.value[i]?.[xKey] ?? '')
})

// DonutChart: data must be number[] (the Y values per row)
const donutData = computed(() => {
  const yField = categories.value[0]?.name
  if (!yField) return []
  return chartData.value.map((row: Record<string, unknown>) => Number(row[yField] ?? 0))
})

// DonutChart segment colors are theme-derived too (per segment, not per series).
const { colorAt: donutColorAt } = useChartPalette()

// DonutChart: categories keyed by X-field value (the segment labels), not Y-field name
const donutCategories = computed(() =>
  Object.fromEntries(
    chartData.value.map((row: Record<string, unknown>, i: number) => {
      const label = String(row[xAxisKey.value] ?? `Item ${i}`)
      return [label, { name: label, color: donutColorAt(i, chartData.value.length) }]
    })
  )
)
</script>

<template>
  <div class="crouton-charts-widget">
    <!-- Title -->
    <h3 v-if="title" class="text-lg font-semibold mb-3">
      {{ title }}
    </h3>

    <!-- Loading state -->
    <div v-if="pending" class="space-y-2">
      <USkeleton class="h-4 w-1/3" />
      <USkeleton :style="{ height: `${height}px` }" class="w-full rounded-lg" />
    </div>

    <!-- Error state -->
    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      title="Failed to load chart data"
      :description="String(error)"
    />

    <!-- Empty state -->
    <div
      v-else-if="!hasData"
      class="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-muted"
      :style="{ height: `${height}px` }"
    >
      <UIcon name="i-lucide-chart-bar" class="size-10 mb-2 opacity-30" />
      <p class="text-sm">No data available</p>
    </div>

    <!-- Donut chart: data must be number[], categories keyed by x-field value -->
    <DonutChart
      v-else-if="type === 'donut'"
      :data="donutData"
      :categories="donutCategories"
      :radius="height / 2"
      :height="height"
    />

    <!-- Bar chart: yAxis (required) = field name array, categories = Record for styling -->
    <BarChart
      v-else-if="type === 'bar'"
      :data="chartData"
      :y-axis="yAxisNames"
      :categories="categoriesObject"
      :x-formatter="xFormatter"
      :height="height"
      :stacked="stacked"
    />

    <!-- Line chart -->
    <LineChart
      v-else-if="type === 'line'"
      :data="chartData"
      :categories="categoriesObject"
      :x-formatter="xFormatter"
      :height="height"
    />

    <!-- Area chart -->
    <AreaChart
      v-else-if="type === 'area'"
      :data="chartData"
      :categories="categoriesObject"
      :x-formatter="xFormatter"
      :height="height"
      :stacked="stacked"
    />
  </div>
</template>
