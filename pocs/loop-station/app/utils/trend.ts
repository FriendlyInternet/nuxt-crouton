/**
 * Shapes the inventory history for the budget trend (#2389). Pure — unit-tested.
 *
 * Two rules, both from the advisor's own policy:
 *  • time, not count, on the x axis — one row per ISO week between the first and
 *    the last record, so an idle stretch is visible as an empty stretch;
 *  • one series per tokenizer — the Anthropic count and the heuristic are ~25%
 *    apart, so they are never drawn as one line or compared to each other.
 */
import type { HistoryRecord } from '../composables/useLoopData'

export const TOKENIZER_COLORS: Record<string, string> = {
  anthropic: 'var(--ko-accent-orange)',
  heuristic: 'var(--ko-text-label)'
}

export interface WeeklyRow { week: string; [tokenizer: string]: number | string | undefined }

const DAY = 86_400_000

/** Monday 00:00 UTC of the ISO week holding `d`. */
export function weekStart(d: Date): Date {
  const u = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const dow = (new Date(u).getUTCDay() + 6) % 7 // Mon = 0
  return new Date(u - dow * DAY)
}

const label = (d: Date) => d.toISOString().slice(0, 10)

/**
 * One row per ISO week from the first to the last record. Per tokenizer, a week's
 * value is its LAST record that week (the state after the week's final merge);
 * weeks with no record for that tokenizer have NO value — `undefined`, not `null`:
 * the chart breaks the line on undefined but draws null as 0 (unovis `fallbackValue`).
 */
export function weeklyRows(history: HistoryRecord[]): WeeklyRow[] {
  const recs = history
    .filter((r) => r?.generatedAt && Number.isFinite(r.totals?.alwaysOnTokens))
    .map((r) => ({ at: new Date(r.generatedAt), tokenizer: r.tokenizer || 'unknown', tokens: r.totals.alwaysOnTokens }))
    .filter((r) => !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
  if (!recs.length) return []

  const first = weekStart(recs[0]!.at).getTime()
  const last = weekStart(recs[recs.length - 1]!.at).getTime()
  const rows: WeeklyRow[] = []
  const byWeek = new Map<number, WeeklyRow>()
  for (let t = first; t <= last; t += 7 * DAY) {
    const row: WeeklyRow = { week: label(new Date(t)) }
    rows.push(row)
    byWeek.set(t, row)
  }
  for (const r of recs) byWeek.get(weekStart(r.at).getTime())![r.tokenizer] = r.tokens // sorted → last wins
  return rows
}

/**
 * The newest record and its delta against the previous record with the SAME
 * tokenizer (null when there is none) — never across tokenizers.
 */
export function latestDelta(history: HistoryRecord[]): { tokens: number; tokenizer: string; delta: number | null } | null {
  const recs = history.filter((r) => r?.generatedAt && Number.isFinite(r.totals?.alwaysOnTokens))
  const latest = recs[recs.length - 1]
  if (!latest) return null
  const tokenizer = latest.tokenizer || 'unknown'
  const prev = recs.slice(0, -1).reverse().find((r) => (r.tokenizer || 'unknown') === tokenizer)
  return { tokens: latest.totals.alwaysOnTokens, tokenizer, delta: prev ? latest.totals.alwaysOnTokens - prev.totals.alwaysOnTokens : null }
}

/** "6 Oct" for a `week` label (ISO date string), always in UTC. */
export function shortDate(week: string): string {
  return new Date(`${week}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export interface IdleStretch { from: string; to: string; weeks: number }

/**
 * Runs of ≥ `minWeeks` consecutive weeks in which NO tokenizer has a value —
 * the stretches worth naming under the chart ("no merges here").
 */
export function idleStretches(rows: WeeklyRow[], tokenizers: string[], minWeeks = 4): IdleStretch[] {
  const out: IdleStretch[] = []
  let start = -1
  const flush = (end: number) => {
    const weeks = end - start + 1
    if (start >= 0 && weeks >= minWeeks) out.push({ from: rows[start]!.week, to: rows[end]!.week, weeks })
    start = -1
  }
  rows.forEach((r, i) => {
    const empty = tokenizers.every((t) => r[t] === undefined)
    if (empty && start < 0) start = i
    if (!empty) flush(i - 1)
  })
  if (start >= 0) flush(rows.length - 1)
  return out
}

/** One plain sentence for assistive tech — the chart itself is a picture. */
export function describeTrend(history: HistoryRecord[]): string {
  const rows = weeklyRows(history)
  const head = latestDelta(history)
  if (!rows.length || !head) return 'No context-budget records yet.'
  const k = (n: number) => `${(n / 1000).toFixed(1)}k`
  const delta = head.delta == null ? 'first point for this tokenizer' : head.delta === 0 ? 'unchanged' : `${head.delta > 0 ? 'up' : 'down'} ${k(Math.abs(head.delta))} since the previous ${head.tokenizer} point`
  return `Always-on context budget, ${shortDate(rows[0]!.week)} to ${shortDate(rows[rows.length - 1]!.week)}, one point per week. Latest: ${k(head.tokens)} tokens (${head.tokenizer} tokenizer), ${delta}.`
}
