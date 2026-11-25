/**
 * Board drop targets (#3916) — where a drag may land, from the rectangles on screen.
 *
 * Pure: no Vue, no DOM. `board-drag.ts` measures the board (frame, tree, groups, panes,
 * resize handles) and asks `resolveTarget` which ONE target a point means, by a fixed
 * order — first match wins:
 *   1. outside the frame, or on a resize handle → nothing
 *   2. inside the frame but outside the tree    → the page (`bottom` below it, …)
 *   3. within BAND of the tree's own sides       → the page's edge
 *   4. within BAND of a group's sides            → beside that group (outermost first)
 *   5. inside a pane                             → that pane (today's edge / middle rule)
 *   6. under a pane, in its column               → that pane's bottom (the nearest above)
 * The tree functions below turn a target into the next tree, through the package's
 * edit functions, unchanged.
 */
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import {
  applyPaneDrop, detachNode, getNode, insertAtPath,
  type NodePath, type DropEdge, type PaneDropEdge,
} from '@fyit/crouton-layout/app/utils/layout-edit'
import { isGroup, movePane } from './board-groups'

export const BAND = 20 // px on screen

export interface Rect { left: number, top: number, right: number, bottom: number }
export type TargetScope = 'pane' | 'group' | 'page'
export interface BoardTarget { scope: TargetScope, path: NodePath, edge: DropEdge, rect: Rect }
export interface BoardGeometry {
  /** The scrolling board frame. */
  frame: Rect
  /** The page's tree. */
  root: Rect
  /** Outermost first (document order). */
  groups: { path: NodePath, rect: Rect }[]
  panes: { path: NodePath, rect: Rect }[]
  /** The resize handles between panes. */
  handles: Rect[]
}

/** Which edge of `rect` the point is nearest; the middle 50% is `center`. */
export function edgeFor(x: number, y: number, rect: Rect): DropEdge {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  const fx = (x - rect.left) / width
  const fy = (y - rect.top) / height
  const dx = Math.min(fx, 1 - fx)
  const dy = Math.min(fy, 1 - fy)
  if (dx > 0.25 && dy > 0.25) return 'center'
  if (dx < dy) return fx < 0.5 ? 'left' : 'right'
  return fy < 0.5 ? 'top' : 'bottom'
}

const inside = (x: number, y: number, r: Rect): boolean =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

const clip = (r: Rect, to: Rect): Rect => ({
  left: Math.max(r.left, to.left),
  top: Math.max(r.top, to.top),
  right: Math.min(r.right, to.right),
  bottom: Math.min(r.bottom, to.bottom),
})

/** The side of `r` within BAND of the point (nearest; ties top, bottom, left, right), or null. */
function bandEdge(x: number, y: number, r: Rect): PaneDropEdge | null {
  const sides: [PaneDropEdge, number][] = [
    ['top', y - r.top],
    ['bottom', r.bottom - y],
    ['left', x - r.left],
    ['right', r.right - x],
  ]
  let best: [PaneDropEdge, number] | null = null
  for (const s of sides) if (s[1] <= BAND && (!best || s[1] < best[1])) best = s
  return best ? best[0] : null
}

const isWithin = (inner: NodePath, outer: NodePath): boolean =>
  outer.length <= inner.length && outer.every((v, i) => v === inner[i])

/** The side of `root` a point outside it (but inside the frame) lies on. */
function outsideEdge(x: number, y: number, root: Rect): PaneDropEdge {
  if (y > root.bottom) return 'bottom'
  if (y < root.top) return 'top'
  return x < root.left ? 'left' : 'right'
}

/** The page target at (x, y): outside the tree, or within BAND of its sides. */
function pageTarget(x: number, y: number, geo: BoardGeometry): BoardTarget | null {
  const edge = inside(x, y, geo.root) ? bandEdge(x, y, geo.root) : outsideEdge(x, y, geo.root)
  return edge ? { scope: 'page', path: [], edge, rect: clip(geo.root, geo.frame) } : null
}

/** The first group (outermost first) whose BAND holds the point. */
function groupTarget(x: number, y: number, geo: BoardGeometry): BoardTarget | null {
  for (const g of geo.groups) {
    const edge = inside(x, y, g.rect) ? bandEdge(x, y, g.rect) : null
    if (edge) return { scope: 'group', path: g.path, edge, rect: clip(g.rect, geo.frame) }
  }
  return null
}

/** The nearest pane above the point, in its column (the empty space under a block). */
function paneAbove(x: number, y: number, geo: BoardGeometry): BoardTarget | null {
  const column = geo.panes.filter(p => p.rect.left <= x && x <= p.rect.right && p.rect.bottom <= y)
  if (!column.length) return null
  const above = column.reduce((a, b) => (b.rect.bottom > a.rect.bottom ? b : a))
  return { scope: 'pane', path: above.path, edge: 'bottom', rect: above.rect }
}

function resolveRaw(x: number, y: number, geo: BoardGeometry): BoardTarget | null {
  // 1. Off the board, or on a resize handle (not a drop spot).
  if (!inside(x, y, geo.frame) || geo.handles.some(h => inside(x, y, h))) return null
  // 2–4. The page (outside the tree, or its band), then a group's band.
  const outer = pageTarget(x, y, geo) ?? groupTarget(x, y, geo)
  if (outer) return outer
  // 5. A block: its edges or its middle.
  const pane = geo.panes.find(p => inside(x, y, p.rect))
  if (pane) return { scope: 'pane', path: pane.path, edge: edgeFor(x, y, pane.rect), rect: pane.rect }
  // 6. The empty space under a block.
  return paneAbove(x, y, geo)
}

/**
 * The one drop target at (x, y), or null. With `dragged` (a pane being moved) a target
 * that is that pane or beneath it — or any target when the whole page is dragged — is
 * null; the guard never falls through to a later rule.
 */
export function resolveTarget(x: number, y: number, geo: BoardGeometry, dragged?: NodePath): BoardTarget | null {
  const t = resolveRaw(x, y, geo)
  if (!t || !dragged) return t
  if (dragged.length === 0 || isWithin(t.path, dragged)) return null
  return t
}

/** True when `root` is a plain (non-group) split that runs along `edge`. */
function runsAlong(root: LayoutNode, edge: DropEdge): boolean {
  if (root.type !== 'split' || isGroup(root)) return false
  const vertical = edge === 'top' || edge === 'bottom'
  return root.direction === (vertical ? 'vertical' : 'horizontal')
}

/**
 * Drop `node` on the page's `edge`: it joins the page's own row/column as first or last
 * when that runs along the edge, otherwise the whole page is wrapped (a full line or
 * column for the new block).
 */
export function dropOnPage(root: LayoutNode, edge: DropEdge, node: LayoutNode): LayoutNode {
  if (edge === 'center') return root
  if (root.type === 'split' && runsAlong(root, edge)) {
    return insertAtPath(root, [], edge === 'top' || edge === 'left' ? 0 : root.children.length, node)
  }
  return applyPaneDrop(root, { path: [], edge }, node)
}

/** A new block (from the palette) placed at a page / group / pane edge. */
export function placeBlock(root: LayoutNode, target: BoardTarget, node: LayoutNode): LayoutNode {
  if (target.edge === 'center') return root // a middle drop is the page handler's (swap)
  if (target.scope === 'page') return dropOnPage(root, target.edge, node)
  return applyPaneDrop(root, { path: target.path, edge: target.edge }, node)
}

/** Move the pane at `from` onto `target`. Returns the SAME root object when nothing moves. */
export function movePaneToTarget(root: LayoutNode, from: NodePath, target: BoardTarget): LayoutNode {
  if (target.scope === 'page') return moveToPage(root, from, target.edge)
  if (target.scope === 'group') return moveToGroup(root, from, target.path, target.edge)
  return movePane(root, from, target.path, target.edge)
}

/** True when the pane at `from` is already first / last in the page's row or column along `edge`. */
function alreadyAtPageEdge(root: LayoutNode, from: NodePath, edge: DropEdge): boolean {
  if (root.type !== 'split' || from.length !== 1 || !runsAlong(root, edge)) return false
  const atStart = edge === 'top' || edge === 'left'
  return from[0] === (atStart ? 0 : root.children.length - 1)
}

function moveToPage(root: LayoutNode, from: NodePath, edge: DropEdge): LayoutNode {
  if (from.length === 0 || edge === 'center' || alreadyAtPageEdge(root, from, edge)) return root
  const { root: lifted, detached } = detachNode(root, from)
  if (!lifted || !detached) return root
  return dropOnPage(lifted, edge, detached)
}

function moveToGroup(root: LayoutNode, from: NodePath, gPath: NodePath, edge: DropEdge): LayoutNode {
  const group = getNode(root, gPath)
  const direct = from.length === gPath.length + 1 && isWithin(from, gPath)
  if (direct && group?.type === 'split' && group.children.length === 2) {
    // One block would be left: no group to be beside, so drop on the other block's edge.
    return movePane(root, from, [...gPath, 1 - from[from.length - 1]!], edge)
  }
  return movePane(root, from, gPath, edge)
}
