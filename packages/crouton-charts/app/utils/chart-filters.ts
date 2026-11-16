/**
 * Generic chart filters (#3928).
 *
 * A chart preset declares which filters it understands; a filter bar on the page sets
 * shared values; each preset chart sends only the filters it declared as query params.
 * crouton-charts knows only the two filter TYPES — what a filter means ("location",
 * "status", "point of sale") belongs to the package that registers the preset.
 */

export interface ChartPeriodFilterDef {
  key: string
  type: 'period'
}

export interface ChartSelectFilterDef {
  key: string
  type: 'select'
  /** i18n key or plain text */
  label: string
  /** GET path returning { items: { value, label }[] }; supports {teamId} */
  optionsApi: string
}

export type ChartFilterDef = ChartPeriodFilterDef | ChartSelectFilterDef

export type ChartPeriodPreset = 'all' | 'thisMonth' | 'last3Months' | 'thisYear' | 'lastYear' | 'custom'

export interface ChartFilterState {
  period: { preset: ChartPeriodPreset, from?: string, to?: string }
  values: Record<string, string>
}

export const CHART_PERIOD_PRESETS: ChartPeriodPreset[] = ['all', 'thisMonth', 'last3Months', 'thisYear', 'lastYear', 'custom']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Inclusive YYYY-MM-DD range for a period preset, relative to `today` (local calendar date). */
export function periodRange(
  period: ChartFilterState['period'],
  today: Date = new Date()
): { from?: string, to?: string } {
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const d = today.getDate()
  switch (period.preset) {
    case 'thisMonth':
      return { from: ymd(y, m, 1), to: ymd(y, m, lastDay(y, m)) }
    case 'last3Months': {
      const start = new Date(y, m - 3, 1) // first day of the month two months back
      return { from: ymd(start.getFullYear(), start.getMonth() + 1, 1), to: ymd(y, m, d) }
    }
    case 'thisYear':
      return { from: ymd(y, 1, 1), to: ymd(y, 12, 31) }
    case 'lastYear':
      return { from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) }
    case 'custom':
      return {
        from: period.from && DATE.test(period.from) ? period.from : undefined,
        to: period.to && DATE.test(period.to) ? period.to : undefined
      }
    default:
      return {}
  }
}

/** Query params for one preset chart: only the filters it declared, only when set. */
export function buildFilterQuery(
  defs: ChartFilterDef[] | undefined,
  state: ChartFilterState,
  today?: Date
): Record<string, string> {
  const query: Record<string, string> = {}
  for (const def of defs || []) {
    if (def.type === 'period') {
      const { from, to } = periodRange(state.period, today)
      if (from) query.from = from
      if (to) query.to = to
    } else {
      const value = state.values[def.key]
      if (value) query[def.key] = value
    }
  }
  return query
}

/** Distinct select filters across presets (first declaration of a key wins). */
export function selectFiltersOf(defsPerPreset: (ChartFilterDef[] | undefined)[]): ChartSelectFilterDef[] {
  const seen = new Map<string, ChartSelectFilterDef>()
  for (const defs of defsPerPreset) {
    for (const def of defs || []) {
      if (def.type === 'select' && !seen.has(def.key)) seen.set(def.key, def)
    }
  }
  return [...seen.values()]
}

/** Whether any of the presets declares a period filter. */
export function hasPeriodFilter(defsPerPreset: (ChartFilterDef[] | undefined)[]): boolean {
  return defsPerPreset.some(defs => (defs || []).some(d => d.type === 'period'))
}
