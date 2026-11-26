import { describe, it, expect } from 'vitest'
import { xTickLabel, rowTicks } from '../app/utils/chart-axis'

// #4565: vue-chrts calls the x formatter with (tickValue, ordinal). When the axis
// shows every 2nd tick, tick VALUE 4 has ordinal 2 — the label must be row 4's.
const rows = Array.from({ length: 10 }, (_, i) => ({ k: `row ${i}`, count: i }))

describe('xTickLabel', () => {
  // covers: T5
  it('labels a tick by its value, not its position among the shown ticks', () => {
    const shown = [0, 2, 4, 6, 8]
    const labels = shown.map(tick => xTickLabel(rows, 'k', tick))
    expect(labels[2]).toBe('row 4')
    expect(labels).toEqual(['row 0', 'row 2', 'row 4', 'row 6', 'row 8'])
  })

  // covers: T5
  it('rounds fractional ticks and is empty out of range', () => {
    expect(xTickLabel(rows, 'k', 3.9999)).toBe('row 4')
    expect(xTickLabel(rows, 'k', 42)).toBe('')
  })
})

describe('rowTicks', () => {
  // covers: T5
  it('gives one tick per row', () => {
    expect(rowTicks(10)).toHaveLength(10)
    expect(rowTicks(3)).toEqual([0, 1, 2])
    expect(rowTicks(0)).toEqual([])
  })
})
