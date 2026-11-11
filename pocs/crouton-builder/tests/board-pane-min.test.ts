import { describe, it, expect } from 'vitest'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { deriveSizing, minWidthResolver } from '@fyit/crouton-layout/app/utils/layout-viability'
import { boardPaneMinPct, BOARD_HANDLE_PX } from '../app/utils/board-pane-min'

// #3746 — the board floors each pane at its block's minWidth, the same floor the served page uses.
const registry = {
  'artists-stats': { minWidth: 200 },
  'artists-list': { minWidth: 260 },
  'artists-form': { minWidth: 320 },
  'spacer': {},
} as any
const minWidthFor = minWidthResolver(registry)

const leaf = (blockId: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
  ({ type: 'leaf', id: blockId, blockId, ...extra } as any)

describe('boardPaneMinPct (#3746)', () => {
  it('editor matches preview at 536px: list pane floored at its 260px minWidth', () => {
    const stats = leaf('artists-stats', { defaultSize: 80 })
    const list = leaf('artists-list', { defaultSize: 20 })
    const listMin = boardPaneMinPct('horizontal', list, 536, 1, minWidthFor)
    expect(listMin).toBeCloseTo(49.1, 1)
    expect((listMin * (536 - BOARD_HANDLE_PX)) / 100).toBeGreaterThanOrEqual(260 - 1e-9)
    // stats' own floor fits alongside, so the clamped board split is [100 - listMin, listMin]
    const statsMin = boardPaneMinPct('horizontal', stats, 536, 1, minWidthFor)
    expect(statsMin + listMin).toBeLessThanOrEqual(100)
    const board = [100 - listMin, listMin]
    const preview = [(1 - 260 / 535) * 100, (260 / 535) * 100]
    expect(Math.abs(board[0]! - preview[0]!)).toBeLessThanOrEqual(2)
    expect(Math.abs(board[1]! - preview[1]!)).toBeLessThanOrEqual(2)
  })

  it('a stored size below the minimum still gets the block floor', () => {
    expect(boardPaneMinPct('horizontal', leaf('artists-list', { defaultSize: 20 }), 536, 1, minWidthFor)).toBeCloseTo(49.1, 1)
    // top row [stats 20, form 80]: stats floored at >= 37.3%
    expect(boardPaneMinPct('horizontal', leaf('artists-stats', { defaultSize: 20 }), 536, 1, minWidthFor)).toBeGreaterThanOrEqual(37.3)
  })

  it('falls back to minSize ?? 10, and an authored minSize above the block floor wins', () => {
    expect(boardPaneMinPct('horizontal', leaf('spacer'), 536, 1, minWidthFor)).toBe(10)
    expect(boardPaneMinPct('horizontal', leaf('artists-list'), 0, 1, minWidthFor)).toBe(10)
    expect(boardPaneMinPct('horizontal', leaf('artists-stats', { minSize: 60 }), 536, 1, minWidthFor)).toBe(60)
    expect(boardPaneMinPct('vertical', leaf('artists-list'), 536, 1, minWidthFor)).toBe(10)
  })

  it('stacking unchanged: [stats, form, list] soft floor 780 > 536 still stacks', () => {
    const row = { type: 'split', id: 's', direction: 'horizontal', children: [leaf('artists-stats'), leaf('artists-form'), leaf('artists-list')] } as any
    expect(deriveSizing(row, registry).softMinWidth).toBe(780)
    expect(deriveSizing(row, registry).softMinWidth).toBeGreaterThan(536)
  })
})
