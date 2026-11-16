<script setup lang="ts">
/**
 * Chart Filters Block — public renderer (#3928)
 *
 * A filter bar for the preset charts on the same page. Shows a period filter when any of
 * those charts declares one, plus one select per distinct `select` filter they declare.
 * Options come from each filter's `optionsApi`. Values live in useChartFilters() (per page).
 * No package knowledge here — what a filter means is declared by the package's presets.
 */
import type { ChartPreset } from '../../composables/useCroutonChartRegistry'
import { CHART_PERIOD_PRESETS, hasPeriodFilter, selectFiltersOf } from '../../utils/chart-filters'
import type { ChartPeriodPreset, ChartSelectFilterDef } from '../../utils/chart-filters'

const { t } = useT()
const { teamId } = useTeamContext()
const { state, presetIds, reset } = useChartFilters()
const chartPresets = useState<ChartPreset[]>('crouton-chart-presets', () => [])

const defsOnPage = computed(() =>
  [...new Set(presetIds.value)].map(id => chartPresets.value.find(p => p.id === id)?.filters)
)
const showPeriod = computed(() => hasPeriodFilter(defsOnPage.value))
const selectFilters = computed<ChartSelectFilterDef[]>(() => selectFiltersOf(defsOnPage.value))

const periodItems = computed(() =>
  CHART_PERIOD_PRESETS.map(p => ({ label: t(`charts.filters.periods.${p}`), value: p }))
)
const periodPreset = computed<ChartPeriodPreset>({
  get: () => state.value.period.preset,
  set: (preset) => { state.value.period = { ...state.value.period, preset } }
})
const customFrom = computed({
  get: () => state.value.period.from || '',
  set: (v: string) => { state.value.period = { ...state.value.period, from: v || undefined } }
})
const customTo = computed({
  get: () => state.value.period.to || '',
  set: (v: string) => { state.value.period = { ...state.value.period, to: v || undefined } }
})

// Options per select filter, loaded once per filter key + team
const ALL = '__all__'
const options = ref<Record<string, { label: string, value: string }[]>>({})
watch([selectFilters, () => toValue(teamId)], async ([filters, team]) => {
  if (!team) return
  for (const f of filters) {
    if (options.value[f.key]) continue
    try {
      const res = await $fetch<{ items: { value: string, label: string }[] }>(f.optionsApi.replace('{teamId}', String(team)))
      options.value = { ...options.value, [f.key]: res?.items || [] }
    } catch {
      options.value = { ...options.value, [f.key]: [] }
    }
  }
}, { immediate: true })

function itemsFor(f: ChartSelectFilterDef) {
  return [{ label: t('charts.filters.all'), value: ALL }, ...(options.value[f.key] || [])]
}
function valueOf(key: string) {
  return state.value.values[key] || ALL
}
function setValue(key: string, value: string) {
  const values = { ...state.value.values }
  if (!value || value === ALL) delete values[key]
  else values[key] = value
  state.value.values = values
}

const isFiltered = computed(() => state.value.period.preset !== 'all' || Object.keys(state.value.values).length > 0)
</script>

<template>
  <div v-if="showPeriod || selectFilters.length" class="chart-filters-block">
    <UFormField v-if="showPeriod" :label="t('charts.filters.period')" class="chart-filters-field">
      <div class="chart-filters-control"><USelect v-model="periodPreset" :items="periodItems" class="w-full" /></div>
    </UFormField>
    <template v-if="showPeriod && periodPreset === 'custom'">
      <UFormField :label="t('charts.filters.from')" class="chart-filters-field">
        <UInput v-model="customFrom" type="date" />
      </UFormField>
      <UFormField :label="t('charts.filters.to')" class="chart-filters-field">
        <UInput v-model="customTo" type="date" />
      </UFormField>
    </template>
    <UFormField v-for="f in selectFilters" :key="f.key" :label="t(f.label, f.label)" class="chart-filters-field">
      <div class="chart-filters-control">
        <USelect
          :model-value="valueOf(f.key)"
          :items="itemsFor(f)"
          class="w-full"
          @update:model-value="(v: string) => setValue(f.key, v)"
        />
      </div>
    </UFormField>
    <UButton
      v-if="isFiltered"
      color="neutral"
      variant="ghost"
      icon="i-lucide-x"
      :label="t('charts.filters.clear')"
      class="chart-filters-clear"
      @click="reset()"
    />
  </div>
</template>

<style scoped>
.chart-filters-block {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  background: var(--ui-bg-elevated);
}
/* Width lives on a wrapper: USelect doesn't forward a class to its visible trigger.
   The dropdown matches the trigger's width, so this also stops "Confir…" truncation. */
.chart-filters-control { width: 13rem; max-width: 100%; }
.chart-filters-clear { margin-left: auto; }
</style>
