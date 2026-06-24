/**
 * Layout viability metric (#710) — the objective gate the layout engine leans on.
 *
 * A layout is *viable* iff every placed block gets at least its declared
 * `minWidth` (px) in its pane, at the target container width(s) we check. This is
 * the cheap, deterministic, regression-testable definition of "we always get a
 * good result": the panes renderer (#706) enforces it at runtime, and the
 * deterministic layout pass (#709) uses it to choose / reject arrangements (an
 * LLM layout in #711 must beat the deterministic default *and* stay viable).
 *
 * Pure (no Nuxt runtime). Width is the only constrained axis: a HORIZONTAL split
 * divides its pane's width among children (by their `defaultSize` percentages,
 * normalized; equal share when unset); a VERTICAL split stacks children, so each
 * child keeps the full width (height divides, not width). Resize-handle pixels
 * are ignored — a few px don't change viability and keeping it size-only makes
 * the metric stable and unit-testable.
 */
import type { LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'

export interface ViabilityViolation {
  /** The block that can't meet its minimum at this container width. */
  blockId: string
  /** Computed pane width (px) the block would actually get. */
  paneWidth: number
  /** The block's declared `minWidth` (px). */
  minWidth: number
  /** The target container width (px) at which this was checked. */
  containerWidth: number
}

export interface ViabilityResult {
  /** True iff there are zero violations across all target widths. */
  viable: boolean
  violations: ViabilityViolation[]
}

/** A block's declared `minWidth` (px), or 0 when undeclared/unknown. */
export type MinWidthResolver = (blockId: string) => number

/** Build a `MinWidthResolver` from a layout-block registry. */
export function minWidthResolver(registry: CroutonLayoutBlockRegistry): MinWidthResolver {
  return (id: string) => registry[id]?.minWidth ?? 0
}

/** Computed width for one placed leaf. */
interface LeafWidth {
  blockId: string
  width: number
}

/** Recursively distribute `width` (px) down the tree, collecting leaf widths. */
function leafWidths(node: LayoutNode, width: number): LeafWidth[] {
  if (node.type === 'leaf') {
    return [{ blockId: node.blockId, width }]
  }

  // Split: horizontal divides width by size share; vertical keeps full width.
  if (node.direction === 'vertical') {
    return node.children.flatMap(child => leafWidths(child, width))
  }

  const shares = node.children.map(c => c.defaultSize ?? 100 / node.children.length)
  const total = shares.reduce((a, b) => a + b, 0) || 1
  return node.children.flatMap((child, i) =>
    leafWidths(child, (width * shares[i]!) / total),
  )
}

/**
 * Check a layout against one or more target container widths.
 *
 * @param root         the layout root node (or pass a full tree via `checkTreeViability`)
 * @param minWidthFor  resolver for each block's declared minimum width
 * @param targetWidths container widths (px) to test — e.g. `[1280, 768, 375]`
 */
export function checkLayoutViability(
  root: LayoutNode,
  minWidthFor: MinWidthResolver,
  targetWidths: number[],
): ViabilityResult {
  const violations: ViabilityViolation[] = []

  for (const containerWidth of targetWidths) {
    for (const leaf of leafWidths(root, containerWidth)) {
      const minWidth = minWidthFor(leaf.blockId)
      // Round to avoid float dust (e.g. 249.99996) tripping the comparison.
      const paneWidth = Math.round(leaf.width * 100) / 100
      if (minWidth > 0 && paneWidth < minWidth) {
        violations.push({ blockId: leaf.blockId, paneWidth, minWidth, containerWidth })
      }
    }
  }

  return { viable: violations.length === 0, violations }
}

/** Convenience: check a full `LayoutTree` (uses `tree.root`). */
export function checkTreeViability(
  tree: LayoutTree,
  minWidthFor: MinWidthResolver,
  targetWidths: number[],
): ViabilityResult {
  return checkLayoutViability(tree.root, minWidthFor, targetWidths)
}

/**
 * The minimum width (px) a whole subtree needs to stay viable — the renderer's
 * runtime floor (#706, the enforcement side of #710). A HORIZONTAL split places
 * its children side by side, so its requirement is the SUM of theirs; a VERTICAL
 * split stacks them (each gets the full width), so its requirement is the MAX.
 * A leaf needs its block's declared `minWidth`. Pure; mirrors the width model in
 * `leafWidths` above so the floor the renderer enforces matches the metric.
 */
export function subtreeMinWidth(node: LayoutNode, minWidthFor: MinWidthResolver): number {
  if (node.type === 'leaf') return minWidthFor(node.blockId)
  const kids = node.children.map(c => subtreeMinWidth(c, minWidthFor))
  if (node.direction === 'vertical') return kids.reduce((a, b) => Math.max(a, b), 0)
  return kids.reduce((a, b) => a + b, 0)
}

/**
 * The `min-size` (percent) a reka-ui `SplitterPanel` should get so the block(s)
 * inside it can't be dragged below their `minWidth` contract (#706 / #710).
 *
 * Only a HORIZONTAL parent constrains width, so we convert the child subtree's
 * px floor against the live `containerWidthPx`; for a VERTICAL parent (width
 * isn't divided) we keep the child's authored `minSize` (a height %). Falls back
 * to the authored `minSize` when the container hasn't measured yet (px ≤ 0) so
 * SSR / first paint stays stable. Capped at 90% so a single panel can't claim
 * the whole group (reka-ui also clamps, but we keep the sum sane).
 */
export function panelMinSizePct(
  parentDirection: 'horizontal' | 'vertical',
  child: LayoutNode,
  containerWidthPx: number,
  minWidthFor: MinWidthResolver,
): number {
  const authored = child.minSize ?? 0
  if (parentDirection !== 'horizontal' || containerWidthPx <= 0) return authored
  const px = subtreeMinWidth(child, minWidthFor)
  if (px <= 0) return authored
  const pct = (px / containerWidthPx) * 100
  return Math.min(Math.max(pct, authored), 90)
}
