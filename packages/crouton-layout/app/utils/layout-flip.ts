/**
 * FLIP reflow helpers (#943) — the *pure* half of animating a split's panes when
 * its children change (a pane detached, a block inserted between panes).
 *
 * `CroutonLayoutRenderer` keys its panes by index, so on a pane-count change the splitter
 * tears down the old panes and builds fresh ones already at their final size — there's
 * nothing in-place to tween. FLIP solves that *without* changing keys or sizing: measure
 * each pane's box BEFORE the change, let the DOM settle, then apply the inverse transform
 * and animate it back to identity. This file is the no-DOM math + identity matching so it's
 * unit-testable; the DOM glue lives in `useLayoutFlip`.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'

/** A measured element box (the subset of DOMRect FLIP needs). */
export interface FlipBox { left: number, top: number, width: number, height: number }

/** The inverse transform that places `next` back where `old` was (top-left origin). */
export interface FlipTransform { dx: number, dy: number, sx: number, sy: number }

/**
 * The FLIP transform from an element's `old` box to its `next` box, top-left origin.
 * Returns `null` when the move/scale is below the thresholds (nothing worth animating)
 * or `next` has no area — so the caller skips untouched panes cleanly.
 */
export function flipTransform(old: FlipBox, next: FlipBox, posEpsilon = 0.5): FlipTransform | null {
  if (next.width <= 0 || next.height <= 0) return null
  const dx = old.left - next.left
  const dy = old.top - next.top
  const sx = old.width / next.width
  const sy = old.height / next.height
  const moved = Math.abs(dx) > posEpsilon || Math.abs(dy) > posEpsilon
  const scaled = Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01
  if (!moved && !scaled) return null
  return { dx, dy, sx, sy }
}

/**
 * A stable, position-independent identity for a node. A detach/insert rebuilds the panes
 * (and `replaceAt` may shed/re-wrap nodes), so object identity isn't guaranteed — but the
 * node's *structure* is. Keying on structure lets a survivor be matched to its old box
 * across the rebuild. Recurses so a nested split is distinguished by its whole shape.
 */
export function contentKey(node: LayoutNode): string {
  if (node.type === 'leaf') return `l:${node.blockId}`
  if (node.type === 'nested') return `n:${node.label ?? ''}:${contentKey(node.layout.root)}`
  return `s:${node.direction}:[${node.children.map(contentKey).join(',')}]`
}

/**
 * Per-child keys for one split's direct children, deduped by occurrence so two structurally
 * identical siblings (e.g. the same block twice) stay distinguishable and match stably across
 * a structural change. The array index lines up with the rendered pane order.
 */
export function siblingKeys(children: LayoutNode[]): string[] {
  const seen = new Map<string, number>()
  return children.map((child) => {
    const k = contentKey(child)
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return `${k}#${n}`
  })
}
