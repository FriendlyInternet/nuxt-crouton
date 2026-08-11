<script setup lang="ts">
/**
 * Per-product totals for the Data pane (#1867).
 *
 * Answers the question an operator asks mid-event standing at the bar —
 * "moeten we nog pils bijbestellen?" — with, beside it, what the kitchen
 * still owes. Two numbers per product: **Verkocht** (units gone from the
 * cellar, delivered or not) and **Nog uit** (units a location still owes).
 *
 * `outstanding: null` renders as an em dash, NOT a zero. Since #1851 a location
 * can opt out of send-out confirmation, and such a product can never have a
 * backlog — which is a different statement from "has none right now". A 0 there
 * reads as "all caught up" and invites waiting for a number that never moves.
 *
 * Presentation decisions (chip state, how a cell reads) are computed here rather
 * than branched in the template — the template started as the most complex thing
 * in the package by cyclomatic count, which is a lot of logic hiding in markup.
 *
 * Auto-imported as <SalesDashboardPerProductTotals>. Mount inside a
 * team-members-only surface — the endpoint requires team membership.
 */
interface Row {
  productId: string
  product: string
  location: string | null
  sold: number
  outstanding: number | null
}

const props = withDefaults(defineProps<{
  teamParam: string
  eventId: string
  /**
   * Poll cadence. Matches the summary above it — a backlog moves on the KDS,
   *  not in this pane, so it must refresh without a user gesture.
   */
  pollMs?: number
  /** Personnel (staff) order filter: exclude / only / all (default all). */
  personnel?: 'all' | 'exclude' | 'only'
}>(), {
  pollMs: 15000
})

const { t } = useT()

const rows = ref<Row[]>([])
const loaded = ref(false)
/** null = every location. */
const locationFilter = ref<string | null>(null)

async function fetchTotals() {
  try {
    const res = await $fetch<{ items: Row[] }>(
      `/api/crouton-sales/teams/${props.teamParam}/charts/per-product-totals`,
      { query: { eventId: props.eventId, personnel: props.personnel } }
    )
    rows.value = res.items ?? []
  } catch {
    // Transient blip — keep the last good numbers rather than blanking the pane.
  } finally {
    loaded.value = true
  }
}

// Locations present in the data, so the filter can't offer an empty bucket.
const locations = computed(() =>
  [...new Set(rows.value.map(r => r.location).filter((l): l is string => !!l))].sort()
)

/** Shown only when there's a choice to make; active styling decided here. */
const chips = computed(() => {
  if (locations.value.length < 2) return []

  const options: Array<{ value: string | null, label: string }> = [
    { value: null, label: t('sales.dashboard.perProduct.allLocations') },
    ...locations.value.map(l => ({ value: l as string | null, label: l }))
  ]

  return options.map((o) => {
    const active = locationFilter.value === o.value
    return {
      ...o,
      variant: active ? 'soft' as const : 'ghost' as const,
      color: active ? 'primary' as const : 'neutral' as const
    }
  })
})

const visibleRows = computed(() =>
  locationFilter.value === null
    ? rows.value
    : rows.value.filter(r => r.location === locationFilter.value)
)

const totalOutstanding = computed(() =>
  visibleRows.value.reduce((s, r) => s + (r.outstanding ?? 0), 0)
)

/** Sum of Verkocht for the rows currently visible (respects the location filter). */
const totalSold = computed(() =>
  visibleRows.value.reduce((s, r) => s + r.sold, 0)
)

/**
 * How each row reads, decided here so the template stays a flat list.
 * The null case is the meaningful one — see the block comment above.
 */
const displayRows = computed(() => visibleRows.value.map((r) => {
  const impossible = r.outstanding === null
  return {
    ...r,
    outstandingText: impossible ? '—' : String(r.outstanding),
    outstandingClass: impossible
      ? 'text-dimmed'
      : (r.outstanding! > 0 ? 'text-warning font-semibold' : 'text-muted font-semibold'),
    outstandingTitle: impossible ? t('sales.dashboard.perProduct.directHandover') : undefined
  }
}))

// A filter whose location disappears from the data would silently show nothing.
watch(locations, (list) => {
  if (locationFilter.value !== null && !list.includes(locationFilter.value)) {
    locationFilter.value = null
  }
})

onMounted(() => {
  fetchTotals()
  useIntervalFn(fetchTotals, props.pollMs)
})

watch(() => props.personnel, () => fetchTotals())
</script>

<template>
  <div class="sales-per-product @container rounded-2xl border border-default bg-elevated/40 p-4">
    <div class="flex items-center justify-between gap-2 mb-3">
      <div class="flex items-center gap-2 text-muted text-xs font-medium uppercase tracking-wide">
        <UIcon
          name="i-lucide-package-search"
          class="size-4"
        />
        {{ t('sales.dashboard.perProduct.title') }}
      </div>
      <span
        v-if="totalOutstanding > 0"
        class="text-xs text-warning font-medium tabular-nums"
      >
        {{ t('sales.dashboard.perProduct.stillOut', { count: totalOutstanding }) }}
      </span>
    </div>

    <div
      v-if="chips.length"
      class="flex flex-wrap gap-1.5 mb-3"
    >
      <UButton
        v-for="chip in chips"
        :key="chip.label"
        size="xs"
        :variant="chip.variant"
        :color="chip.color"
        :label="chip.label"
        @click="locationFilter = chip.value"
      />
    </div>

    <p
      v-if="loaded && !displayRows.length"
      class="text-sm text-muted py-2"
    >
      {{ t('sales.dashboard.noSalesYet') }}
    </p>

    <template v-else>
      <div class="flex items-center gap-3 pb-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
        <span class="flex-1" />
        <span class="w-12 text-right">{{ t('sales.dashboard.perProduct.sold') }}</span>
        <span class="w-12 text-right">{{ t('sales.dashboard.perProduct.outstanding') }}</span>
      </div>

      <ul class="divide-y divide-default/60">
        <li
          v-for="r in displayRows"
          :key="r.productId"
          class="flex items-center gap-3 py-2"
        >
          <span class="flex-1 min-w-0">
            <span class="block truncate text-sm">{{ r.product }}</span>
            <span
              v-if="r.location"
              class="block truncate text-[11px] text-muted"
            >{{ r.location }}</span>
          </span>
          <span class="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{{ r.sold }}</span>
          <span
            class="w-12 shrink-0 text-right text-sm tabular-nums"
            :class="r.outstandingClass"
            :title="r.outstandingTitle"
          >{{ r.outstandingText }}</span>
        </li>
      </ul>

      <div class="flex items-center gap-3 pt-2 mt-1 border-t border-default text-sm font-semibold">
        <span class="flex-1">{{ t('sales.dashboard.perProduct.total') }}</span>
        <span class="w-12 shrink-0 text-right tabular-nums">{{ totalSold }}</span>
        <span class="w-12 shrink-0 text-right tabular-nums">{{ totalOutstanding }}</span>
      </div>
    </template>
  </div>
</template>
