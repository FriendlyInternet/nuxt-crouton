/**
 * Orders-list request shaping — behaviour contract for the team-authed
 * "Bestellingen" endpoint's pure helpers (`server/utils/order-filters`). The
 * DB/drizzle part (buildWhere) lives in the handler; everything testable
 * without a database is here, the same split as `my-orders-shape`.
 */
import { describe, it, expect } from 'vitest'
import {
  PRINT_STATUS_BUCKETS,
  printStatusBucket,
  parseOrderFilters,
  parsePageParams,
  parseLocationRemarks
} from '../server/utils/order-filters'

describe('printStatusBucket', () => {
  it('maps each register bucket to the crouton-printing job-status codes', () => {
    expect(printStatusBucket('busy')).toEqual(['0', '1'])
    expect(printStatusBucket('done')).toEqual(['2'])
    expect(printStatusBucket('failed')).toEqual(['9'])
    // The exported map is the single source of truth for both.
    expect(PRINT_STATUS_BUCKETS.busy).toEqual(['0', '1'])
  })

  it('returns null for no filter or an unknown bucket (no accidental match)', () => {
    expect(printStatusBucket(undefined)).toBeNull()
    expect(printStatusBucket(null)).toBeNull()
    expect(printStatusBucket('')).toBeNull()
    expect(printStatusBucket('bogus')).toBeNull()
  })
})

describe('parseOrderFilters', () => {
  it('reads the four supported filters and coerces to strings', () => {
    expect(parseOrderFilters({ owner: 'Anna', clientId: 'c1', printerId: 'p1', printStatus: 'busy' }))
      .toEqual({ owner: 'Anna', clientId: 'c1', printerId: 'p1', printStatus: 'busy' })
  })

  it('leaves absent/empty filters undefined so they drop out of the WHERE', () => {
    expect(parseOrderFilters({})).toEqual({
      owner: undefined,
      clientId: undefined,
      printerId: undefined,
      printStatus: undefined
    })
    // Empty string must not become a filter that matches nothing.
    expect(parseOrderFilters({ owner: '' }).owner).toBeUndefined()
  })

  it('ignores unrelated query params', () => {
    const f = parseOrderFilters({ owner: 'Bram', page: '2', pageSize: '25', foo: 'bar' })
    expect(f).toEqual({ owner: 'Bram', clientId: undefined, printerId: undefined, printStatus: undefined })
  })
})

describe('parsePageParams', () => {
  it('defaults to page 1 and the given page size', () => {
    expect(parsePageParams({})).toEqual({ page: 1, pageSize: 25, offset: 0 })
    expect(parsePageParams({}, 10)).toEqual({ page: 1, pageSize: 10, offset: 0 })
  })

  it('computes the offset from page and size', () => {
    expect(parsePageParams({ page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20, offset: 40 })
  })

  it('clamps out-of-range values', () => {
    expect(parsePageParams({ page: '0', pageSize: '0' }).page).toBe(1)
    expect(parsePageParams({ page: '-5' }).page).toBe(1)
    expect(parsePageParams({ pageSize: '9999' }).pageSize).toBe(100)
    expect(parsePageParams({ pageSize: 'abc' }).pageSize).toBe(25)
  })
})

describe('parseLocationRemarks', () => {
  it('revives a JSON string in place', () => {
    const rows = [{ id: 'o1', locationRemarks: '{"loc1":"extra hot"}' }]
    parseLocationRemarks(rows)
    expect(rows[0].locationRemarks).toEqual({ loc1: 'extra hot' })
  })

  it('nulls a malformed value instead of throwing (a bad row must not 500)', () => {
    const rows = [{ id: 'o1', locationRemarks: '{not json' }]
    parseLocationRemarks(rows)
    expect(rows[0].locationRemarks).toBeNull()
  })

  it('leaves already-parsed / absent values untouched', () => {
    const obj = { loc1: 'x' }
    const rows = [
      { id: 'a', locationRemarks: obj },
      { id: 'b', locationRemarks: null },
      { id: 'c' }
    ]
    parseLocationRemarks(rows as any)
    expect(rows[0].locationRemarks).toBe(obj)
    expect(rows[1].locationRemarks).toBeNull()
    expect((rows[2] as any).locationRemarks).toBeUndefined()
  })
})
