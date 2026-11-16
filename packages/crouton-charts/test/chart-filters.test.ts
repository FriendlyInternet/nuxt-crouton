import { describe, it, expect } from 'vitest'
import { periodRange, buildFilterQuery, selectFiltersOf, hasPeriodFilter } from '../app/utils/chart-filters'
import type { ChartFilterDef, ChartFilterState } from '../app/utils/chart-filters'

const today = new Date(2026, 10, 16) // 16 Nov 2026 (local)
const state = (over: Partial<ChartFilterState> = {}): ChartFilterState => ({ period: { preset: 'all' }, values: {}, ...over })

describe('periodRange', () => {
  it('all time → no bounds', () => {
    expect(periodRange({ preset: 'all' }, today)).toEqual({})
  })
  it('this month → first to last day', () => {
    expect(periodRange({ preset: 'thisMonth' }, today)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })
  it('last 3 months → start of the month two months back to today', () => {
    expect(periodRange({ preset: 'last3Months' }, today)).toEqual({ from: '2026-09-01', to: '2026-11-16' })
  })
  it('last 3 months crosses the year boundary', () => {
    expect(periodRange({ preset: 'last3Months' }, new Date(2027, 0, 10))).toEqual({ from: '2026-11-01', to: '2027-01-10' })
  })
  it('this year / last year', () => {
    expect(periodRange({ preset: 'thisYear' }, today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange({ preset: 'lastYear' }, today)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })
  it('custom keeps only well-formed dates', () => {
    expect(periodRange({ preset: 'custom', from: '2026-02-01', to: 'nope' }, today)).toEqual({ from: '2026-02-01', to: undefined })
  })
  it('February has 28/29 days', () => {
    expect(periodRange({ preset: 'thisMonth' }, new Date(2028, 1, 3))).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('buildFilterQuery', () => {
  const defs: ChartFilterDef[] = [
    { key: 'period', type: 'period' },
    { key: 'location', type: 'select', label: 'Location', optionsApi: '/x' }
  ]
  it('sends only declared filters that are set', () => {
    const s = state({ period: { preset: 'thisYear' }, values: { location: 'loc1', status: 'confirmed' } })
    expect(buildFilterQuery(defs, s, today)).toEqual({ from: '2026-01-01', to: '2026-12-31', location: 'loc1' })
  })
  it('nothing set → empty query', () => {
    expect(buildFilterQuery(defs, state(), today)).toEqual({})
  })
  it('no declared filters → empty query, even with values set', () => {
    expect(buildFilterQuery(undefined, state({ values: { location: 'x' } }), today)).toEqual({})
  })
})

describe('filters across presets', () => {
  const a: ChartFilterDef[] = [{ key: 'period', type: 'period' }, { key: 'status', type: 'select', label: 'A', optionsApi: '/a' }]
  const b: ChartFilterDef[] = [{ key: 'status', type: 'select', label: 'B', optionsApi: '/b' }, { key: 'location', type: 'select', label: 'L', optionsApi: '/l' }]
  it('distinct select filters, first declaration wins', () => {
    expect(selectFiltersOf([a, b, undefined]).map(f => [f.key, f.label])).toEqual([['status', 'A'], ['location', 'L']])
  })
  it('period shown when any preset declares it', () => {
    expect(hasPeriodFilter([b, a])).toBe(true)
    expect(hasPeriodFilter([b, undefined])).toBe(false)
  })
})
