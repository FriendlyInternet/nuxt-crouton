/**
 * Chart Preset Registry
 *
 * Allows packages to register named chart presets that appear in the
 * page editor's chart block preset picker.
 *
 * Packages (e.g., crouton-bookings) call registerChartPreset() in a
 * Nuxt plugin. The chart block reads available presets via getChartPresets().
 *
 * The registry state uses a fixed key ('crouton-chart-presets') so that
 * other packages can read it directly via useState() without importing
 * from crouton-charts.
 */

export interface ChartPresetConfig {
  /** Direct API path. Supports {teamId} placeholder. Bypasses collection registry. */
  apiPath?: string
  /** Collection key (uses collection registry when apiPath not set) */
  collection?: string
  type?: 'bar' | 'line' | 'area' | 'donut'
  xField?: string
  yFields?: string
  title?: string
  height?: number
  stacked?: boolean
  orientation?: 'vertical' | 'horizontal'
}

import type { ChartFilterDef } from '../utils/chart-filters'

export interface ChartPreset {
  id: string
  name: string
  description?: string
  icon?: string
  /** Source package (e.g., 'crouton-bookings') */
  package: string
  config: ChartPresetConfig
  /** Filters this chart understands (shown by a chart-filters block on the same page, #3928) */
  filters?: ChartFilterDef[]
}

export function useCroutonChartRegistry() {
  const chartPresets = useState<ChartPreset[]>('crouton-chart-presets', () => [])

  function registerChartPreset(preset: ChartPreset) {
    if (!chartPresets.value.find(p => p.id === preset.id)) {
      chartPresets.value.push(preset)
    }
  }

  function getChartPresets(pkg?: string): ChartPreset[] {
    if (pkg) return chartPresets.value.filter(p => p.package === pkg)
    return chartPresets.value
  }

  function getChartPreset(id: string): ChartPreset | undefined {
    return chartPresets.value.find(p => p.id === id)
  }

  return { registerChartPreset, getChartPresets, getChartPreset, chartPresets }
}
