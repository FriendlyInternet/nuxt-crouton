/**
 * Budget trend shaping (#2389): time on the x axis, one series per tokenizer,
 * deltas only within a tokenizer.
 *   npx vitest run tests/trend.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { weeklyRows, latestDelta, weekStart, idleStretches, shortDate, describeTrend } from '../app/utils/trend'

const rec = (at: string, tokenizer: string, tokens: number) =>
  ({ generatedAt: at, tokenizer, totals: { alwaysOnTokens: tokens } }) as any

describe('weeklyRows', () => {
  it('emits one row per ISO week from first to last record, empty weeks included', () => {
    const rows = weeklyRows([rec('2026-06-29T10:00:00Z', 'anthropic', 100), rec('2026-07-27T10:00:00Z', 'anthropic', 120)])
    expect(rows.map((r) => r.week)).toEqual(['2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
    expect(rows.map((r) => r.anthropic)).toEqual([100, undefined, undefined, undefined, 120])
    expect('anthropic' in rows[1]!).toBe(false) // absent, not null — null would draw as 0
  })

  it('keeps tokenizers as separate series; a week holds the LAST record per tokenizer', () => {
    const rows = weeklyRows([
      rec('2026-07-01T08:00:00Z', 'heuristic', 200),
      rec('2026-07-01T09:00:00Z', 'anthropic', 150),
      rec('2026-07-02T09:00:00Z', 'anthropic', 160)
    ])
    expect(rows).toEqual([{ week: '2026-06-29', heuristic: 200, anthropic: 160 }])
  })

  it('tolerates unsorted input and junk records', () => {
    const rows = weeklyRows([rec('2026-07-08T00:00:00Z', 'anthropic', 2), rec('2026-07-01T00:00:00Z', 'anthropic', 1), { generatedAt: 'nope', tokenizer: 'anthropic', totals: {} } as any])
    expect(rows.map((r) => r.anthropic)).toEqual([1, 2])
  })

  it('weekStart is Monday 00:00 UTC', () => {
    expect(weekStart(new Date('2026-10-24T13:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z') // Sat → Mon
    expect(weekStart(new Date('2026-10-19T00:00:00Z')).toISOString()).toBe('2026-10-19T00:00:00.000Z') // Mon stays
  })
})

describe('latestDelta', () => {
  it('compares only to the previous record with the same tokenizer', () => {
    const h = [rec('2026-07-01T00:00:00Z', 'anthropic', 100), rec('2026-07-02T00:00:00Z', 'heuristic', 130), rec('2026-07-03T00:00:00Z', 'anthropic', 110)]
    expect(latestDelta(h)).toEqual({ tokens: 110, tokenizer: 'anthropic', delta: 10 })
  })
  it('has no delta when the tokenizer has no earlier point', () => {
    const h = [rec('2026-07-01T00:00:00Z', 'heuristic', 130), rec('2026-07-03T00:00:00Z', 'anthropic', 110)]
    expect(latestDelta(h)).toEqual({ tokens: 110, tokenizer: 'anthropic', delta: null })
  })
})

describe('on the committed history', () => {
  const history = readFileSync(new URL('../../../writeups/loop-station/history.jsonl', import.meta.url), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))

  it('shows the Aug→Oct idle stretch as empty weeks, and the two tokenizers never share a step', () => {
    const rows = weeklyRows(history)
    const idle = rows.filter((r) => r.week >= '2026-08-17' && r.week <= '2026-10-05')
    expect(idle.length).toBeGreaterThanOrEqual(7)
    expect(idle.every((r) => r.anthropic === undefined && r.heuristic === undefined)).toBe(true)
    const d = latestDelta(history)!
    expect(d.tokenizer).toBe('anthropic')
    expect(Math.abs(d.delta ?? 0)).toBeLessThan(1500) // no fake ±4k tokenizer step
  })
})

describe('idleStretches / shortDate / describeTrend', () => {
  it('names runs of ≥ minWeeks empty weeks, including one at the end', () => {
    const rows = [{ week: 'w1', a: 1 }, { week: 'w2' }, { week: 'w3' }, { week: 'w4' }, { week: 'w5' }, { week: 'w6', a: 2 }, { week: 'w7' }, { week: 'w8' }]
    expect(idleStretches(rows, ['a'], 4)).toEqual([{ from: 'w2', to: 'w5', weeks: 4 }])
    expect(idleStretches(rows, ['a'], 2)).toEqual([{ from: 'w2', to: 'w5', weeks: 4 }, { from: 'w7', to: 'w8', weeks: 2 }])
  })
  it('shortDate is UTC and compact', () => {
    expect(shortDate('2026-10-05')).toBe('5 Oct')
  })
  it('describeTrend reads as one plain sentence', () => {
    const h = [rec('2026-07-01T00:00:00Z', 'anthropic', 19000), rec('2026-07-08T00:00:00Z', 'anthropic', 19860)]
    expect(describeTrend(h)).toBe('Always-on context budget, 29 Jun to 6 Jul, one point per week. Latest: 19.9k tokens (anthropic tokenizer), up 0.9k since the previous anthropic point.')
  })
})
