import { describe, it, expect } from 'vitest'
import { parseBookingChartFilters } from '../server/utils/chart-filters'

const TZ = 'Europe/Brussels'

describe('parseBookingChartFilters', () => {
  it('from/to are whole calendar days in the booking timezone (to inclusive)', () => {
    const f = parseBookingChartFilters({ from: '2026-11-01', to: '2026-11-30' }, TZ)
    expect(f.fromDate?.toISOString()).toBe('2026-10-31T23:00:00.000Z') // 1 Nov 00:00 CET
    expect(f.toDate?.toISOString()).toBe('2026-11-30T23:00:00.000Z') // 1 Dec 00:00 CET (exclusive)
  })
  it('handles summer time', () => {
    const f = parseBookingChartFilters({ from: '2026-07-01' }, TZ)
    expect(f.fromDate?.toISOString()).toBe('2026-06-30T22:00:00.000Z') // CEST
  })
  it('passes location and status ids', () => {
    expect(parseBookingChartFilters({ location: 'UNYWfOBhHPciqX5iU5Z9I', status: 'confirmed' }, TZ))
      .toEqual({ location: 'UNYWfOBhHPciqX5iU5Z9I', status: 'confirmed' })
  })
  it('ignores malformed values', () => {
    expect(parseBookingChartFilters({ from: '01/11/2026', to: '2026-13-45x', location: "x' OR 1=1", status: '' }, TZ)).toEqual({})
  })
  it('nothing given → no filters', () => {
    expect(parseBookingChartFilters({}, TZ)).toEqual({})
  })
  it('takes the first value of a repeated param', () => {
    expect(parseBookingChartFilters({ status: ['pending', 'confirmed'] }, TZ)).toEqual({ status: 'pending' })
  })
})
