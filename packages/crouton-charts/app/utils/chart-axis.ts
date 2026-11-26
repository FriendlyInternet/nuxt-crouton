/**
 * X-axis helpers for CroutonChartsWidget (#4565).
 *
 * vue-chrts calls the x formatter with `(tickValue, ordinal, ticks)`. The tick
 * VALUE is the row index; the ordinal is the tick's position among the ticks
 * shown, which differs as soon as the axis skips ticks. Labels must follow the value.
 */

/** The label for the tick at row index `tick` (rounded; '' when out of range). */
export function xTickLabel(rows: Record<string, unknown>[], key: string, tick: number): string {
  return String(rows[Math.round(tick)]?.[key] ?? '')
}

/** One tick per row: `[0, 1, …, n-1]`. */
export function rowTicks(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i)
}
