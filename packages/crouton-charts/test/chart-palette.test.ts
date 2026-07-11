import { describe, it, expect } from 'vitest'
import {
  parseOklch,
  buildThemePalette,
  getChartColor,
  CHART_COLOR_PALETTE
} from '../app/utils/chart-constants'

const ORANGE = 'oklch(70.5% 0.213 47.604)' // Tailwind primary=orange, light
const GRAY = 'oklch(55.6% 0 0)' // eink / black-and-white theme primary

describe('parseOklch', () => {
  it('parses a percentage lightness to 0–1', () => {
    expect(parseOklch(ORANGE)).toEqual({ l: 0.705, c: 0.213, h: 47.604 })
  })
  it('parses a fractional lightness as-is', () => {
    expect(parseOklch('oklch(0.62 0.19 260)')).toEqual({ l: 0.62, c: 0.19, h: 260 })
  })
  it('tolerates a trailing alpha', () => {
    expect(parseOklch('oklch(0.62 0.19 260 / 0.5)')).toEqual({ l: 0.62, c: 0.19, h: 260 })
  })
  it('returns null for junk / missing', () => {
    expect(parseOklch(null)).toBeNull()
    expect(parseOklch('rgb(1,2,3)')).toBeNull()
    expect(parseOklch('')).toBeNull()
  })
})

describe('buildThemePalette', () => {
  it('falls back to the static palette when no primary (SSR)', () => {
    expect(buildThemePalette(null, 3)).toEqual([
      CHART_COLOR_PALETTE[0], CHART_COLOR_PALETTE[1], CHART_COLOR_PALETTE[2]
    ])
  })

  it('a single series is exactly the primary', () => {
    expect(buildThemePalette(ORANGE, 1)).toEqual(['oklch(0.705 0.213 47.6)'])
  })

  it('single series stays the primary even when grayscale', () => {
    expect(buildThemePalette(GRAY, 1)).toEqual(['oklch(0.556 0 0)'])
  })

  it('chromatic multi: series 0 is the primary, rest sweep hue at the same L/C', () => {
    const pal = buildThemePalette(ORANGE, 4)
    expect(pal).toHaveLength(4)
    // series 0 == primary
    expect(pal[0]).toBe('oklch(0.705 0.213 47.6)')
    // all share L & C, only hue differs, evenly by 360/4 = 90°
    const parsed = pal.map(c => parseOklch(c)!)
    expect(parsed.every(p => p.l === 0.705 && p.c === 0.213)).toBe(true)
    expect(parsed.map(p => Math.round(p.h))).toEqual([48, 138, 228, 318])
    // no two series share a color
    expect(new Set(pal).size).toBe(4)
  })

  it('grayscale multi: a lightness ramp (chroma 0, increasing L, all distinct)', () => {
    const pal = buildThemePalette(GRAY, 4)
    const parsed = pal.map(c => parseOklch(c)!)
    expect(parsed.every(p => p.c === 0)).toBe(true)
    // strictly increasing lightness → distinguishable
    for (let i = 1; i < parsed.length; i++) {
      expect(parsed[i]!.l).toBeGreaterThan(parsed[i - 1]!.l)
    }
    expect(new Set(pal).size).toBe(4)
  })
})

describe('getChartColor', () => {
  it('is theme-aware when a primary is passed', () => {
    expect(getChartColor(0, 1, ORANGE)).toBe('oklch(0.705 0.213 47.6)')
  })
  it('is the static palette without a primary', () => {
    expect(getChartColor(0, 5)).toBe(CHART_COLOR_PALETTE[0])
  })
})
