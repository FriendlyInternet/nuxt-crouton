/**
 * Builder layout sizing — how big a Vue Flow block-node is on the canvas.
 *
 * A node renders a `LayoutNode` (a single block, or a composed split of blocks); its
 * FOOTPRINT is how many block-cells it spans on each axis, so a 2-high stack is twice
 * as tall and a neighbour can match it. Auto-imported (app/utils).
 *
 * Graduated from the demo POC's `spike-layout.ts`. This slice carries only the SIZING
 * contract (footprint / sizeOf / deriveSizing) that the board canvas + node card need;
 * the gesture injection-keys + pane-drop edit helpers arrive with the gesture slice.
 *
 * NOTE the sizing floors here are the POC-side prototype; the clean home is the
 * `@fyit/crouton-layout` viability engine (graduation workstream #983-3/4).
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

/** One block-cell on the canvas. A footprint of NxM = N*BASE_W by M*BASE_H px. */
export const BUILDER_BASE_W = 256
export const BUILDER_BASE_H = 184

/** Which edge of a target a dragged block will snap to (mirrors layout-snap's edge). */
export type BuilderSnapEdge = 'left' | 'right' | 'top' | 'bottom'

/** How many block-cells wide × tall this node spans (1×1 for a leaf). */
export function footprint(node: LayoutNode): { cols: number, rows: number } {
  if (node.type === 'leaf') return { cols: 1, rows: 1 }
  if (node.type === 'nested') return footprint(node.layout.root)
  const fps = node.children.map(footprint)
  if (node.direction === 'horizontal') {
    return { cols: fps.reduce((s, f) => s + f.cols, 0), rows: Math.max(...fps.map(f => f.rows)) }
  }
  return { cols: Math.max(...fps.map(f => f.cols)), rows: fps.reduce((s, f) => s + f.rows, 0) }
}

/** Pixel size of a node on the canvas (footprint × the base block size). */
export function sizeOf(node: LayoutNode): { width: number, height: number } {
  const f = footprint(node)
  return { width: f.cols * BUILDER_BASE_W, height: f.rows * BUILDER_BASE_H }
}

/** A pane (leaf) of a composed node + the box it occupies. Box units match the `rect` passed in
 *  (flow px when seeded with the card's flow rect; 0..1 fractions when seeded with the unit rect). */
export interface BuilderPaneRect { path: number[], rect: { left: number, top: number, width: number, height: number } }

/**
 * Walk a composed node into its top-level panes' sub-rects — mirroring exactly how
 * `BuilderNodePreview` divides space (by each child's `defaultSize`, else an equal share). Used by
 * pane-drop (spec: `pane-drop-beside`) to find WHICH pane a dragged card is over and place it beside
 * that pane. A `nested` node is treated as one opaque pane (its inner layout edits in its own space).
 */
export function collectLeaves(
  node: LayoutNode,
  rect: { left: number, top: number, width: number, height: number } = { left: 0, top: 0, width: 1, height: 1 },
  path: number[] = [],
  out: BuilderPaneRect[] = [],
): BuilderPaneRect[] {
  if (node.type === 'leaf' || node.type === 'nested') { out.push({ path, rect }); return out }
  const kids = node.children
  const sizes = kids.map(c => (c.defaultSize && c.defaultSize > 0 ? c.defaultSize : 0))
  const total = sizes.reduce((s, v) => s + v, 0)
  const equal = 1 / kids.length
  let acc = 0
  kids.forEach((c, i) => {
    const frac = total > 0 && sizes[i]! > 0 ? sizes[i]! / total : equal
    const sub = node.direction === 'horizontal'
      ? { left: rect.left + acc * rect.width, top: rect.top, width: frac * rect.width, height: rect.height }
      : { left: rect.left, top: rect.top + acc * rect.height, width: rect.width, height: frac * rect.height }
    collectLeaves(c, sub, [...path, i], out)
    acc += frac
  })
  return out
}

/**
 * Block sizing descriptor — "the component decides its own size" as DECLARED DATA. Each block
 * declares how it fills a pane per axis: `fill` stretches to the pane, `hug` sizes to its own
 * content (a Top bar / Bottom nav declare `height: 'hug'` → short bars). Lives on the
 * `croutonLayoutBlocks` registry entries (app.config), so one source feeds the renderer, the
 * viability metric, and an agent alike.
 */
export type BuilderSizing = 'fill' | 'hug'
export interface BuilderBlockSizing { width: BuilderSizing, height: BuilderSizing }
export const BUILDER_DEFAULT_SIZING: BuilderBlockSizing = { width: 'fill', height: 'fill' }

/** A registry shape carrying the optional sizing descriptor (the app.config entries), read loosely. */
type SizedRegistry = Record<string, { sizing?: { width?: string, height?: string }, minWidth?: number } | undefined>

const asSizing = (v: unknown): BuilderSizing => (v === 'hug' ? 'hug' : 'fill')

/** The sizing a block declares (defaults to fully `fill`). Reads the descriptor off the registry. */
export function blockSizing(blockId: string, registry: SizedRegistry): BuilderBlockSizing {
  const s = registry[blockId]?.sizing
  return { width: asSizing(s?.width), height: asSizing(s?.height) }
}

/**
 * Composite sizing derivation — "component-driven, all the way up". A LEAF declares its rules
 * (minWidth + fill/hug on the registry); a COMPOSITE (split / nested) DERIVES its own bottom-up,
 * with two width floors:
 *   • softMinWidth — the comfortable width that keeps a horizontal split a ROW (`sum` along a
 *     horizontal axis, `max` across a vertical one). Below it, the renderer stacks the row.
 *   • hardMinWidth — the absolute floor it can reflow DOWN to: a horizontal split can always stack
 *     to a column whose floor is the widest child, so hard = `max` of children's hard floors.
 * Height mirrors width with axes swapped. A composite always `fill`s; a leaf uses its descriptor.
 */
export interface BuilderDerivedSizing { hardMinWidth: number, softMinWidth: number, minHeight: number, width: BuilderSizing, height: BuilderSizing }
export function deriveSizing(node: LayoutNode, registry: SizedRegistry): BuilderDerivedSizing {
  if (node.type === 'leaf') {
    const mw = registry[node.blockId]?.minWidth ?? 0
    const s = blockSizing(node.blockId, registry)
    return { hardMinWidth: mw, softMinWidth: mw, minHeight: 0, width: s.width, height: s.height }
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
