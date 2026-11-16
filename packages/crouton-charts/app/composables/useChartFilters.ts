/**
 * Shared chart-filter state for the current page (#3928).
 *
 * The filter bar block writes it; every preset chart block on the same page reads it and
 * registers its preset id, so the bar shows only filters those charts declare. State is
 * keyed by route path, so two pages never share filter choices.
 */
import type { ChartFilterState } from '../utils/chart-filters'

export function useChartFilters() {
  const route = useRoute()
  const key = computed(() => route.path)

  const allState = useState<Record<string, ChartFilterState>>('crouton-chart-filters', () => ({}))
  const allPresets = useState<Record<string, string[]>>('crouton-chart-filter-presets', () => ({}))

  const state = computed<ChartFilterState>(() => {
    if (!allState.value[key.value]) {
      allState.value[key.value] = { period: { preset: 'all' }, values: {} }
    }
    return allState.value[key.value]!
  })

  /** Preset ids of the charts currently on this page */
  const presetIds = computed(() => allPresets.value[key.value] || [])

  function registerPreset(id: string) {
    const list = allPresets.value[key.value] || []
    allPresets.value[key.value] = [...list, id] // duplicates kept: one entry per chart block
  }

  function unregisterPreset(id: string) {
    const list = [...(allPresets.value[key.value] || [])]
    const i = list.indexOf(id)
    if (i >= 0) list.splice(i, 1)
    allPresets.value[key.value] = list
  }

  function reset() {
    allState.value[key.value] = { period: { preset: 'all' }, values: {} }
  }

  return { state, presetIds, registerPreset, unregisterPreset, reset }
}
