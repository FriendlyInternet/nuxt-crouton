/**
 * layout-compose-bridge (WS8, #899) — the pure translation between a `LayoutTree`
 * (the single shared model the renderer / breakpoint author edit) and the free
 * `ComposePiece[]` the WS4 compose canvas manipulates.
 *
 * The zoom shell renders the compose canvas at the App level (L2). The canvas thinks
 * in floating cards; every other surface thinks in one tree. This module is the
 * isomorphism between the two so an edit on the canvas (snap two panes together) is
 * the SAME edit the breakpoint author sees when you zoom in — no per-surface copy.
 *
 *  - `treeToPieces(tree)` — explode a layout into draggable cards: a `split` root's
 *    top-level children each become a free piece (tiled along the split axis), so the
 *    user can re-arrange them; a `leaf` / `nested` root is a single piece.
 *  - `piecesToTree(pieces, base)` — recompose the authoritative tree: one piece → its
 *    node IS the root; many pieces → a split of them (axis inferred from their on-canvas
 *    arrangement), sizes apportioned by extent. The base tree's `renderer` /
 *    `breakpoints` carry through (compose only ever restructures `root`).
 *
 * Round-trip stable for the cases that matter: `piecesToTree(treeToPieces(t))` returns
 * a tree that renders the same blocks in the same arrangement.
 */
import type { LayoutNode, LayoutSplit, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import type { NodePath } from './layout-edit'
import type { ComposePiece } from '../composables/useCroutonComposeGestures'

export interface TreeToPiecesOptions {
  /** Default card size + tiling origin/gap (px). The canvas re-fits on measure. */
  width?: number
  height?: number
  gap?: number
  originX?: number
  originY?: number
  /**
   * Force a single vertical column regardless of the split direction — the mobile
   * layout, where horizontal tiling would overflow a narrow canvas and the cards
   * pile up on top of each other once the canvas clamps them. Default: tile along
   * the split axis.
   */
  column?: boolean
  /** Resolve a human label for a node (e.g. a block's registry `name`). */
  labelOf?: (node: LayoutNode) => string | undefined
}

/** A short, stable-ish key for a node, for piece ids. */
function nodeKey(node: LayoutNode): string {
  if (node.type === 'leaf') return node.blockId
  if (node.type === 'nested') return node.label ? `app-${node.label}` : 'app'
  return 'group'
}

function defaultLabel(node: LayoutNode): string | undefined {
  if (node.type === 'nested') return node.label || 'App'
  return undefined
}

/**
 * Explode a layout tree into free compose pieces. A `split` root decomposes into one
 * piece per top-level child (tiled along the split direction); any other root is a
 * single piece. Positions are a simple tiling — the canvas clamps/re-fits to its own
 * measured size, so they only need to be non-overlapping and on-canvas-ish.
 */
export function treeToPieces(tree: LayoutTree, opts: TreeToPiecesOptions = {}): ComposePiece[] {
  const { width = 240, height = 160, gap = 16, originX = 16, originY = 16, column = false } = opts
  const labelOf = opts.labelOf ?? defaultLabel
  const root = tree.root
  // `column` forces vertical stacking (mobile); otherwise tile along the split axis.
  const horizontal = column ? false : root.type === 'split' ? root.direction === 'horizontal' : true
  const nodes: LayoutNode[] = root.type === 'split' ? root.children : [root]
  return nodes.map((node, i) => ({
    id: `piece-${i}-${nodeKey(node)}`,
    node,
    x: horizontal ? originX + i * (width + gap) : originX,
    y: horizontal ? originY : originY + i * (height + gap),
    width,
    height,
    ...(labelOf(node) ? { label: labelOf(node) } : {}),
  }))
}

/** Centre of a piece on the canvas. */
const cx = (p: ComposePiece) => p.x + p.width / 2
const cy = (p: ComposePiece) => p.y + p.height / 2

/**
 * The pieces ordered as `piecesToTree` will lay them out: axis inferred from the
 * spread of centres, then sorted along it. The single source of ordering truth so
 * `piecesToTree` and `piecePath` can never disagree.
 */
function orderPieces(pieces: ComposePiece[]): { ordered: ComposePiece[], horizontal: boolean } {
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a)
  const horizontal = spread(pieces.map(cx)) >= spread(pieces.map(cy))
  const ordered = pieces.slice().sort((a, b) => (horizontal ? cx(a) - cx(b) : cy(a) - cy(b)))
  return { ordered, horizontal }
}

/**
 * The `NodePath` of a piece's node within `piecesToTree(pieces)` — so a click on a
 * canvas card maps to a zoom target. A single piece IS the root (path `[]`); among
 * many, the path is its index in the recomposed split (i.e. its position-sorted slot).
 * Returns `null` if the piece isn't present.
 */
export function piecePath(pieces: ComposePiece[], pieceId: string): NodePath | null {
  if (!pieces.some(p => p.id === pieceId)) return null
  if (pieces.length === 1) return []
  const { ordered } = orderPieces(pieces)
  const idx = ordered.findIndex(p => p.id === pieceId)
  return idx < 0 ? null : [idx]
}

/**
 * Recompose the authoritative tree from the free pieces. Zero pieces → the base tree
 * unchanged (nothing to bind). One piece → its node is the whole root. Many pieces →
 * a split: the axis is inferred from how the pieces are laid out (wider spread in x ⇒
 * horizontal), ordered along that axis, with `defaultSize` apportioned by extent so
 * the recomposed split keeps the visual proportions. `renderer` / `breakpoints` come from
 * `base` (compose restructures `root` only).
 */
export function piecesToTree(pieces: ComposePiece[], base?: LayoutTree): LayoutTree {
  const renderer = base?.renderer ?? 'panes'
  const carry = {
    ...(base?.breakpoints ? { breakpoints: base.breakpoints } : {}),
  }
  if (pieces.length === 0) {
    return base ?? { renderer, root: { type: 'split', direction: 'horizontal', children: [] } }
  }
  if (pieces.length === 1) {
    return { renderer, root: pieces[0]!.node, ...carry }
  }
  // Infer the dominant axis from the spread of piece centres, then order along it.
  const { ordered, horizontal } = orderPieces(pieces)
  const extents = ordered.map(p => (horizontal ? p.width : p.height))
  const total = extents.reduce((s, e) => s + e, 0) || ordered.length
  const children: LayoutNode[] = ordered.map((p, i) => ({
    ...p.node,
    defaultSize: Math.round((extents[i]! / total) * 1000) / 10,
  }))
  const root: LayoutSplit = {
    type: 'split',
    direction: horizontal ? 'horizontal' : 'vertical',
    children,
  }
  return { renderer, root, ...carry }
}
