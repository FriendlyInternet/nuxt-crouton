import type { ChartPresetConfig } from '../composables/useCroutonChartRegistry'

/** Shared color palette for all chart types (10 visually distinct hues) */
export const CHART_COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
] as const

/** Below this OKLCH chroma the primary is effectively grayscale (monochrome
 *  themes, e.g. eink/black-and-white): hue-rotation can't make distinct
 *  categorical colors, so we ramp lightness instead. */
const ACHROMATIC_CHROMA = 0.03

interface Oklch { l: number, c: number, h: number }

/** Parse an `oklch(L C H)` / `oklch(L% C H [/ a])` string (the form Tailwind v4
 *  / Nuxt UI emit, read back verbatim from getComputedStyle). L is normalised
 *  to 0–1. Returns null for anything unparseable. */
export function parseOklch(value: string | null | undefined): Oklch | null {
  if (!value) return null
  const m = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value)
  if (!m) return null
  const l = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1])
  const c = Number(m[3])
  const h = Number(m[4])
  if ([l, c, h].some(n => Number.isNaN(n))) return null
  return { l, c, h }
}

const oklchStr = (l: number, c: number, h: number) =>
  `oklch(${+l.toFixed(4)} ${+c.toFixed(4)} ${+h.toFixed(2)})`

/**
 * Build the ordered series palette for `count` series, derived from the theme
 * `primary` (an OKLCH string, e.g. from `--ui-primary`). Dep-free: we stay in
 * OKLCH the whole way, which renders directly in SVG fills.
 *
 * - No primary (SSR / unparseable) → the static curated palette (unchanged
 *   first-paint behaviour).
 * - 1 series → the primary itself (themed, even if grayscale).
 * - Chromatic primary → series 0 = primary; series i = primary's L & C with
 *   hue stepped evenly around the wheel (distinct but on-theme).
 * - Grayscale primary (chroma < ACHROMATIC_CHROMA) → a lightness ramp (still
 *   monochrome, but the series stay distinguishable).
 */
export function buildThemePalette(primary: string | null | undefined, count: number): string[] {
  const n = Math.max(1, count)
  const base = parseOklch(primary)
  if (!base) return Array.from({ length: n }, (_, i) => staticColor(i, n))
  if (n === 1) return [oklchStr(base.l, base.c, base.h)]

  if (base.c < ACHROMATIC_CHROMA) {
    // Even lightness ramp across a readable mid band (dark→light gray).
    const lo = 0.4, hi = 0.78
    return Array.from({ length: n }, (_, i) =>
      oklchStr(lo + (hi - lo) * (i / (n - 1)), 0, 0))
  }

  // series 0 = primary; the rest sweep hue evenly from it.
  return Array.from({ length: n }, (_, i) =>
    oklchStr(base.l, base.c, (base.h + (i * 360) / n) % 360))
}

/** The original curated/HSL palette — the fallback when no theme primary is
 *  available (SSR) and the base for grayscale themes' extra series. */
function staticColor(index: number, total: number): string {
  if (total <= CHART_COLOR_PALETTE.length) {
    return CHART_COLOR_PALETTE[index % CHART_COLOR_PALETTE.length]!
  }
  const hue = Math.round((index * 360) / total)
  return `hsl(${hue} 65% 55%)`
}

/**
 * Color for series `index` of `total` — theme-aware when a resolved `primary`
 * OKLCH string is passed (see `useChartPalette`), else the static palette.
 */
export function getChartColor(index: number, total: number, primary?: string | null): string {
  const pal = buildThemePalette(primary, total)
  return pal[index % pal.length]!
}

/** Block attrs for chart editor blocks (used by both View and Render) */
export interface ChartBlockAttrs {
  mode?: 'collection' | 'preset'
  preset?: string
  collection: string
  chartType: string
  xField?: string
  yFields?: string
  title?: string
  height?: number | string
  stacked?: boolean
}
