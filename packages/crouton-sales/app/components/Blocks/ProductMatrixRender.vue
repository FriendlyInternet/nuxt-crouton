<script setup lang="ts">
/**
 * Product × Day Matrix Block Renderer
 *
 * Pivot table: rows = products, columns = days, last column = Total, with an
 * interactive Units ⇄ Revenue toggle. Data from the product-day-matrix
 * endpoint (team-members only). Pure UTable — no charts dependency — so it
 * renders safely in the editor preview too.
 *
 * BlockContent.vue wraps this in <ClientOnly> (clientOnly: true in block def).
 */
import type { TableColumn } from '@nuxt/ui'

interface MatrixProduct {
  product: string
  units: Record<string, number>
  revenue: Record<string, number>
  totalUnits: number
  totalRevenue: number
}
interface Matrix {
  days: string[]
  products: MatrixProduct[]
  dayTotals: Record<string, { units: number, revenue: number }>
  grandTotal: { units: number, revenue: number }
}

interface SalesProductMatrixAttrs {
  eventScope?: string
  measure?: 'units' | 'revenue'
  /** Personnel (staff) order filter: exclude / only / all (default all). */
  personnel?: 'all' | 'exclude' | 'only'
  title?: string
}

const props = defineProps<{ attrs: SalesProductMatrixAttrs }>()

const { t } = useT()
const { teamId } = useTeamContext()

const measure = ref<'units' | 'revenue'>(props.attrs.measure === 'revenue' ? 'revenue' : 'units')

const matrix = ref<Matrix | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)

async function load() {
  pending.value = true
  error.value = null
  try {
    const query: Record<string, string> = {}
    if (props.attrs.eventScope) query.eventId = props.attrs.eventScope
    if (props.attrs.personnel) query.personnel = props.attrs.personnel
    matrix.value = await $fetch<Matrix>(
      `/api/crouton-sales/teams/${toValue(teamId)}/charts/product-day-matrix`,
      { query }
    )
  } catch (e: any) {
    error.value = e?.data?.message || e?.statusMessage || 'Failed to load table data'
  } finally {
    pending.value = false
  }
}

onMounted(load)
watch(() => [props.attrs.eventScope, props.attrs.personnel], load)

// Live beside the kassa (Data pane): checkout emits the salesOrders mutation
// hook, so a fresh order re-pivots the table — otherwise it only loaded on
// mount while the summary tiles above it poll. Harmless on public CMS pages
// (no admin mutations fire there).
const unhookMutation = useNuxtApp().hook('crouton:mutation', (payload: any) => {
  if (payload.collection !== 'salesOrders') return
  load()
})
onUnmounted(unhookMutation)

function fmt(n: number) {
  return measure.value === 'revenue' ? n.toFixed(2) : String(Math.round(n))
}
// '2026-05-20' → '05-20'
function shortDay(d: string) {
  return d.slice(5)
}

// Numbers right-aligned; the Total column visually separated + emphasized.
const columns = computed<TableColumn<Record<string, unknown>>[]>(() => {
  if (!matrix.value) return []
  const numeric = { class: { th: 'text-right', td: 'text-right' } }
  return [
    {
      accessorKey: 'product',
      header: t('sales.block.product'),
      meta: { class: { td: 'font-medium text-highlighted' } }
    },
    ...matrix.value.days.map(d => ({ accessorKey: d, header: shortDay(d), meta: numeric })),
    {
      accessorKey: '__total',
      header: t('sales.block.total'),
      meta: { class: {
        th: 'text-right border-s border-default',
        td: 'text-right border-s border-default font-semibold'
      } }
    }
  ]
})

const rows = computed<Record<string, unknown>[]>(() => {
  const m = matrix.value
  if (!m) return []
  const key = measure.value

  const data = m.products.map((p) => {
    const row: Record<string, unknown> = { product: p.product }
    for (const d of m.days) row[d] = fmt((key === 'units' ? p.units : p.revenue)[d] ?? 0)
    row.__total = fmt(key === 'units' ? p.totalUnits : p.totalRevenue)
    return row
  })

  // Column-totals row
  const totalRow: Record<string, unknown> = { product: t('sales.block.total') }
  for (const d of m.days) totalRow[d] = fmt(m.dayTotals[d]?.[key] ?? 0)
  totalRow.__total = fmt(m.grandTotal[key])
  data.push(totalRow)

  return data
})

const hasData = computed(() => (matrix.value?.products.length ?? 0) > 0)

// Escape a CSV cell (quote when it contains a comma, quote or newline).
function csvCell(v: string | number) {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Download the table (current measure) as a spreadsheet-friendly CSV.
function downloadCsv() {
  const m = matrix.value
  if (!m) return
  const key = measure.value

  const lines: (string | number)[][] = [['Product', ...m.days, 'Total']]
  for (const p of m.products) {
    lines.push([
      p.product,
      ...m.days.map(d => fmt((key === 'units' ? p.units : p.revenue)[d] ?? 0)),
      fmt(key === 'units' ? p.totalUnits : p.totalRevenue)
    ])
  }
  lines.push([
    'Total',
    ...m.days.map(d => fmt(m.dayTotals[d]?.[key] ?? 0)),
    fmt(m.grandTotal[key])
  ])

  // Prepend a UTF-8 BOM so Excel reads accented product names correctly.
  const csv = '﻿' + lines.map(r => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sales-${key}-by-product-and-day.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="sales-product-matrix @container space-y-3">
    <!-- Header sizes to the COMPONENT (@container): in a narrow pane the
         toggle/CSV drop their labels to icons on one tidy row; wide contexts
         keep the labeled buttons. -->
    <div class="flex items-center justify-between gap-2">
      <h3 v-if="attrs.title" class="min-w-0 truncate text-base @sm:text-lg font-semibold">{{ attrs.title }}</h3>
      <div class="ms-auto flex shrink-0 items-center gap-3">
        <UFieldGroup size="sm">
          <UButton
            :color="measure === 'units' ? 'primary' : 'neutral'"
            :variant="measure === 'units' ? 'solid' : 'outline'"
            icon="i-lucide-hash"
            :aria-label="t('sales.block.units')"
            @click="measure = 'units'"
          >
            <span class="hidden @sm:inline">{{ t('sales.block.units') }}</span>
          </UButton>
          <UButton
            :color="measure === 'revenue' ? 'primary' : 'neutral'"
            :variant="measure === 'revenue' ? 'solid' : 'outline'"
            icon="i-lucide-banknote"
            :aria-label="t('sales.block.revenue')"
            @click="measure = 'revenue'"
          >
            <span class="hidden @sm:inline">{{ t('sales.block.revenue') }}</span>
          </UButton>
        </UFieldGroup>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          :disabled="!hasData"
          aria-label="CSV"
          @click="downloadCsv"
        >
          <span class="hidden @sm:inline">CSV</span>
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-alert-circle"
      :title="error"
    />

    <div
      v-else-if="!pending && !hasData"
      class="flex flex-col items-center justify-center rounded-lg border border-dashed border-default text-muted py-10"
    >
      <UIcon name="i-lucide-table" class="size-8 mb-2 opacity-30" />
      <p class="text-sm">{{ t('sales.block.noSalesData') }}</p>
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-default">
      <UTable
        :loading="pending"
        :data="rows"
        :columns="columns"
        :ui="{
          th: 'px-2.5 py-2 @sm:px-3 whitespace-nowrap',
          td: 'px-2.5 py-1.5 @sm:px-3 @sm:py-2 tabular-nums whitespace-nowrap',
          tr: 'last:font-semibold last:bg-muted/30'
        }"
      />
    </div>
  </div>
</template>
