import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { panelMinSizePct, type MinWidthResolver } from '@fyit/crouton-layout/app/utils/layout-viability'

/** Board resize-handle thickness (BoardTree's `w-1.5`). */
export const BOARD_HANDLE_PX = 6

/**
 * A board pane's splitter min-size (%) (#3746): its block's minWidth — the same floor
 * the served page uses — never below the old 10% grab floor or an authored minSize.
 * Width 0 (not measured yet) or a vertical split → the fallback.
 */
export function boardPaneMinPct(
  direction: 'horizontal' | 'vertical',
  child: LayoutNode,
  splitWidthPx: number,
  handles: number,
  minWidthFor: MinWidthResolver,
): number {
  const fallback = child.minSize ?? 10
  const basis = splitWidthPx - handles * BOARD_HANDLE_PX
  return Math.max(fallback, panelMinSizePct(direction, child, basis, minWidthFor))
}
