import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { deriveSizing } from '@fyit/crouton-layout/app/utils/layout-viability'

/** Board resize-handle thickness (BoardTree's `w-1.5`). */
export const BOARD_HANDLE_PX = 6

/**
 * A board pane's splitter min-size (%) (#3746): the floor the served page gives the same
 * pane — `deriveSizing(child).hardMinWidth` (`LayoutRenderer`'s `viewChildStyle`): a
 * leaf's minWidth, and for a nested split its widest single block (it stacks below its
 * own soft floor, on the page and on the board). Never below the old 10% grab floor or
 * an authored minSize; capped at 90% like `panelMinSizePct`.
 * Width 0 (not measured yet) or a vertical split → the fallback.
 */
export function boardPaneMinPct(
  direction: 'horizontal' | 'vertical',
  child: LayoutNode,
  splitWidthPx: number,
  handles: number,
  registry: CroutonLayoutBlockRegistry,
): number {
  const fallback = child.minSize ?? 10
  const basis = splitWidthPx - handles * BOARD_HANDLE_PX
  if (direction !== 'horizontal' || basis <= 0) return fallback
  const px = deriveSizing(child, registry).hardMinWidth
  if (px <= 0) return fallback
  return Math.max(fallback, Math.min((px / basis) * 100, 90))
}
