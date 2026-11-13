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
import type { CroutonLayoutBlockRegistry, LayoutAxisSizing, LayoutBlockSizing } from '@fyit/crouton-core/app/types/layout-block'
import { DEFAULT_BLOCK_SIZING } from '@fyit/crouton-core/app/types/layout-block'

export { DEFAULT_BLOCK_SIZING }
export type { LayoutBlockSizing, LayoutAxisSizing }

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

  // Nested: the pane this node occupies IS the container for its sub-layout, so
  // recurse from the sub-layout's root with the same width (WS2 #871).
  if (node.type === 'nested') {
    return leafWidths(node.layout.root, width)
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
  // Nested: a sub-layout's floor is its own root's floor at this pane (WS2 #871).
  if (node.type === 'nested') return subtreeMinWidth(node.layout.root, minWidthFor)
  const kids = node.children.map(c => subtreeMinWidth(c, minWidthFor))
  if (node.direction === 'vertical') return kids.reduce((a, b) => Math.max(a, b), 0)
  return kids.reduce((a, b) => a + b, 0)
}

// ─── Typed component contract: fill/hug + composite derivation (#986) ─────────

/** Narrow an arbitrary value to a `LayoutAxisSizing` (default `fill`) — robust to
 *  widened/tampered registry data (app.config literals widen to `string`). */
const asAxisSizing = (v: unknown): LayoutAxisSizing => (v === 'hug' ? 'hug' : 'fill')

/** A block's declared fill/hug descriptor (default fully `fill`). */
export type SizingResolver = (blockId: string) => LayoutBlockSizing

/** Build a `SizingResolver` from a layout-block registry. */
export function sizingResolver(registry: CroutonLayoutBlockRegistry): SizingResolver {
  return (id: string) => {
    const s = registry[id]?.sizing
    return { width: asAxisSizing(s?.width), height: asAxisSizing(s?.height) }
  }
}

/** The sizing a composed subtree publishes — folded bottom-up from its leaves. */
export interface DerivedSizing {
  /** Absolute floor it can reflow DOWN to: a split can always stack to a column,
   *  so this is the widest single leaf in the subtree (recursively). */
  hardMinWidth: number
  /** Comfortable floor that keeps the arrangement as-is: sum along a horizontal
   *  axis, max across a vertical one. Equals `subtreeMinWidth` (reused contract). */
  softMinWidth: number
  /** Height floor, mirroring width with the axes swapped (sum vertical / max horizontal). */
  minHeight: number
  /** A composite always `fill`s (a real layout claims its space); a leaf uses its descriptor. */
  width: LayoutAxisSizing
  height: LayoutAxisSizing
}

/**
 * Composite sizing derivation (#986) — "a leaf declares, a composite derives",
 * component-driven all the way up a layout-of-layouts. A LEAF reports its declared
 * `minWidth`/`minHeight` + fill/hug; a SPLIT/NESTED folds its children bottom-up so
 * a parent (or an agent) reasons about a sub-layout as one unit. `softMinWidth`
 * deliberately mirrors `subtreeMinWidth` (the renderer's runtime floor) so the two
 * can't drift; `hardMinWidth` is the extra "reflow to a column" floor the renderer
 * stacks down to. Pure; reads the registry directly (minWidth + minHeight + sizing).
 */
export function deriveSizing(node: LayoutNode, registry: CroutonLayoutBlockRegistry): DerivedSizing {
  if (node.type === 'leaf') {
    const def = registry[node.blockId]
    const mw = def?.minWidth ?? 0
    const s = sizingResolver(registry)(node.blockId)
    return { hardMinWidth: mw, softMinWidth: mw, minHeight: def?.minHeight ?? 0, width: s.width, height: s.height }
  }
  if (node.type === 'nested') return deriveSizing(node.layout.root, registry)
  const kids = node.children.map(c => deriveSizing(c, registry))
  const horizontal = node.direction === 'horizontal'
  const hardMinWidth = Math.max(0, ...kids.map(k => k.hardMinWidth))
  const softMinWidth = horizontal
    ? kids.reduce((sum, k) => sum + k.softMinWidth, 0)
    : Math.max(0, ...kids.map(k => k.softMinWidth))
  const minHeight = horizontal
    ? Math.max(0, ...kids.map(k => k.minHeight))
    : kids.reduce((sum, k) => sum + k.minHeight, 0)
  return { hardMinWidth, softMinWidth, minHeight, width: 'fill', height: 'fill' }
}

/**
 * A vertical split's page row tracks (#983, #3865) — the `grid-template-rows` a read-only
 * render gives its children: a Fit (`height: 'hug'`) child is `auto`; a Fill child flows to
 * content but never below its derived floor, `minmax(<minHeight>px, auto)`. One expression
 * for the package renderer's view grid and the Builder board, so the two can't drift.
 */
export function pageRowTracks(children: LayoutNode[], registry: CroutonLayoutBlockRegistry): string {
  return children
    .map((child) => {
      const d = deriveSizing(child, registry)
      return d.height === 'hug' ? 'auto' : `minmax(${Math.round(d.minHeight)}px, auto)`
    })
    .join(' ')
}

/** A block's bounded display-variant option list (#986), or `[]` when none declared. */
export function blockVariants(registry: CroutonLayoutBlockRegistry, blockId: string): string[] {
  const v = registry[blockId]?.variants
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Resolve a (possibly untrusted) variant value against a block's declared options:
 * a known value is kept; an unknown one falls back to the FIRST declared option;
 * a block with no variants resolves to `undefined`. The bounded, agent-pickable read.
 */
export function resolveVariant(registry: CroutonLayoutBlockRegistry, blockId: string, value: unknown): string | undefined {
  const opts = blockVariants(registry, blockId)
  if (opts.length === 0) return undefined
  return typeof value === 'string' && opts.includes(value) ? value : opts[0]
}

/**
 * The `minSize` (percent) a USplitter pane should get so the block(s)
 * inside it can't be dragged below their `minWidth` contract (#706 / #710).
 *
 * Only a HORIZONTAL parent constrains width, so we convert the child subtree's
 * px floor against the live `containerWidthPx`; for a VERTICAL parent (width
 * isn't divided) we keep the child's authored `minSize` (a height %). Falls back
 * to the authored `minSize` when the container hasn't measured yet (px ≤ 0) so
 * SSR / first paint stays stable. Capped at 90% so a single panel can't claim
 * the whole group (the splitter also clamps, but we keep the sum sane).
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
