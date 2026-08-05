import { describe, it, expect } from 'vitest'
import {
  D1_MAX_BOUND_PARAMS,
  boundParamsPerRow,
  chunkForBoundParams,
  chunkRowsForTable,
} from '../shared/utils/d1'

/**
 * The contract that keeps a multi-row INSERT under D1's 100-bound-parameter cap (#1707, #1710).
 * These pin the CEILING, not any particular batch size — what must hold is that no statement
 * we hand to D1 can exceed it, whatever batching we choose.
 */

/** Stand-in for `getTableColumns(table)`: only `hasDefault` matters here. */
const columns = (supplied: string[], defaulted: string[], plain: string[] = []) => {
  const cols: Record<string, { hasDefault?: boolean }> = {}
  for (const n of supplied) cols[n] = {}
  for (const n of defaulted) cols[n] = { hasDefault: true }
  for (const n of plain) cols[n] = {}
  return cols
}

describe('boundParamsPerRow — what drizzle really binds', () => {
  it('counts the columns the row supplies', () => {
    const cols = columns(['a', 'b', 'c'], [])
    expect(boundParamsPerRow(cols, { a: 1, b: 2, c: 3 })).toBe(3)
  })

  it('ALSO counts defaulted columns the row omits — the undercount that caused #1710', () => {
    // printJobs in miniature: 2 supplied, 2 filled by $default, 2 neither.
    const cols = columns(['id', 'payload'], ['createdAt', 'updatedAt'], ['errorMessage', 'completedAt'])
    const row = { id: 'x', payload: 'p' }

    expect(Object.keys(row)).toHaveLength(2) // what a naive helper would count
    expect(boundParamsPerRow(cols, row)).toBe(4) // what D1 is actually charged
  })

  it('does not count a column that is neither supplied nor defaulted', () => {
    const cols = columns(['a'], [], ['nullableNoDefault'])
    expect(boundParamsPerRow(cols, { a: 1 })).toBe(1)
  })

  it('counts a defaulted column the row DOES supply exactly once', () => {
    const cols = columns([], ['id'])
    expect(boundParamsPerRow(cols, { id: 'explicit' })).toBe(1)
  })
})

describe('chunkForBoundParams — the ceiling', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ i }))

  it('never lets a batch exceed the cap', () => {
    for (const [count, perRow] of [[8, 18], [43, 20], [100, 7], [3, 99]] as const) {
      for (const batch of chunkForBoundParams(rows(count), perRow)) {
        expect(batch.length * perRow).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
      }
    }
  })

  it('preserves every row, in order', () => {
    const input = rows(43)
    expect(chunkForBoundParams(input, 20).flat()).toEqual(input)
  })

  it('does not split a batch that already fits', () => {
    expect(chunkForBoundParams(rows(5), 18)).toHaveLength(1) // 90 ≤ 100
  })

  it('issues nothing at all for an empty list', () => {
    expect(chunkForBoundParams([], 18)).toEqual([])
  })

  it('still makes progress on a row too wide to ever fit — one per batch, never a zero-size chunk', () => {
    const chunks = chunkForBoundParams(rows(3), 120)
    expect(chunks).toHaveLength(3)
    expect(chunks.every(c => c.length === 1)).toBe(true)
  })

  it('honours a caller-supplied cap', () => {
    expect(chunkForBoundParams(rows(4), 10, 20)).toHaveLength(2) // 2 rows per batch
  })
})

describe('chunkRowsForTable — derive then chunk', () => {
  it('sizes batches by the TRUE cost, not the row keys', () => {
    // 16 supplied + 2 defaulted = 18/row → 5 rows max, NOT the 6 that 16 keys would allow.
    const supplied = Array.from({ length: 16 }, (_, i) => `c${i}`)
    const cols = columns(supplied, ['createdAt', 'updatedAt'])
    const row = Object.fromEntries(supplied.map(k => [k, 1]))
    const rows = Array.from({ length: 8 }, () => ({ ...row }))

    const chunks = chunkRowsForTable(rows, cols)

    expect(chunks[0]).toHaveLength(5)
    for (const batch of chunks) {
      expect(batch.length * 18).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS)
    }
    expect(chunks.flat()).toHaveLength(8)
  })

  it('issues nothing for an empty list', () => {
    expect(chunkRowsForTable([], { a: {} })).toEqual([])
  })
})
