/**
 * Spike board helpers (#907/#972) — the pure, non-reactive half of the spike-app board:
 * the FlowNode shape the Vue Flow canvas renders, tree/label walks, the snap-intent
 * geometry (which pane/edge a dragged node wants to land on), the positional "As placed"
 * infer, and board-extent math. Auto-imported (app/utils).
 */
import type { LayoutBreakpoint, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { closestSnap, type Rect, type SnapTarget } from '@fyit/crouton-layout/app/utils/layout-snap'
import { sizeOf } from './spike-layout'
import type { SnapEdge, SpikePaneDrop, SpikeRegion } from './spike-layout'

// Free (Vue Flow free placement) ⇄ Snap (magnetic compose canvas). Non-exclusive: you can
// drop in Free, switch to Snap to bind by hand, and either feeds the same compile/magic.
export type CanvasMode = 'free' | 'snap'

/** The CroutonFlow camera surface the board drives (fit / centre framing). */
export interface SpikeFlowHandle {
  fitView?: (o?: Record<string, unknown>) => void
  fitBounds?: (b: { x: number, y: number, width: number, height: number }, o?: Record<string, unknown>) => void
  setCenter?: (x: number, y: number, o?: Record<string, unknown>) => void
}

// Pre-built Vue Flow nodes (CroutonFlow ephemeral mode renders these directly). A node's
// `data.node` is a single leaf when freshly dropped, or a bound SPLIT once blocks snap
// together (#907) — the merged unit then drags as one node.
// `bp` = authored responsive breakpoints for this node's layout (#907 layer 2), set in the
// breakpoint slider you zoom into. Structural edits (snap/detach) create nodes WITHOUT bp, so
// authored breakpoints reset when the structure they targeted changes — which is the right thing.
export interface FlowNode { id: string, type: string, position: { x: number, y: number }, data: { node: LayoutNode, label?: string, bp?: LayoutBreakpoint[], isPage?: boolean, justAdded?: boolean, region?: SpikeRegion, width?: number, height?: number } }

export function JSONclone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }

export function labelFor(node: LayoutNode): string {
  if (node.type === 'leaf') { const h = node.config?.heading; return typeof h === 'string' ? h : node.blockId }
  if (node.type === 'nested') return node.label || 'App'
  return 'Group'
}

/** Collect every placed block (blockId + heading) under a layout node. */
export function flattenLeaves(node: LayoutNode): { blockId: string, label?: string }[] {
  if (node.type === 'leaf') {
    const heading = node.config?.heading
    return [{ blockId: node.blockId, label: typeof heading === 'string' ? heading : undefined }]
  }
  if (node.type === 'split') return node.children.flatMap(flattenLeaves)
  if (node.type === 'nested') return flattenLeaves(node.layout.root)
  return []
}

/** Combine two nodes into a split, flattening same-direction nesting so a third block joins
 *  the existing group as a sibling (and so spans the group's full cross-size, not just one). */
export function combineNodes(a: LayoutNode, b: LayoutNode, direction: 'horizontal' | 'vertical', aFirst: boolean): LayoutNode {
  const ordered = aFirst ? [a, b] : [b, a]
  const children = ordered.flatMap(n => (n.type === 'split' && n.direction === direction) ? n.children : [n])
  return { type: 'split', direction, children }
}

// Snap tuning — shared by the live preview and the on-release merge so the glowing edge
// you saw is exactly the edge it clicks onto.
const SNAP_OPTS = { gap: 160, align: 0.2 } as const

/** Geometry-only: which other node (and its edge) a block dragged to `pos` snaps to, or null.
 *  `others` are the candidate nodes; the dragged block's footprint comes from `movedNode`. */
function snapAt(movedNode: LayoutNode, pos: { x: number, y: number }, others: FlowNode[]) {
  const md = sizeOf(movedNode)
  const drag: Rect = { x: pos.x, y: pos.y, width: md.width, height: md.height }
  const targets: SnapTarget[] = others.map((o, idx) => {
    const s = sizeOf(o.data.node)
    return { path: [idx], rect: { x: o.position.x, y: o.position.y, width: s.width, height: s.height } }
  })
  const snap = closestSnap(drag, targets, SNAP_OPTS)
  if (!snap) return null
  return { target: others[snap.path[0]!]!, edge: snap.edge, tRect: targets[snap.path[0]!]!.rect, md }
}

// Where a dragged node wants to land (#972): PANEDROP — dropped OVER a layout, add it beside the pane
// under the cursor on the side you're nearest; or EDGE-merge onto a side of a NEARBY card (the original
// proximity snap, for building from loose cards).
export type SnapIntent =
  | { kind: 'panedrop', target: FlowNode, paneDrop: SpikePaneDrop }
  | { kind: 'edge', target: FlowNode, edge: SnapEdge }
type FlowRect = { x: number, y: number, w: number, h: number }
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
// Collect every LEAF pane (and nested app — a single drop target) with its flow-space sub-rect, walking
// each split's children by their `defaultSize` proportions. The pane under the cursor is the drop
// target; `[]` means the whole node is one pane (a lone block). Mirrors the renderer's child sizing.
function collectLeaves(node: LayoutNode, rect: FlowRect, path: number[], out: { path: number[], rect: FlowRect }[]) {
  if (node.type !== 'split') { out.push({ path, rect }); return } // leaf OR nested app = a drop target
  const horizontal = node.direction === 'horizontal'
  const sizes = node.children.map(c => c.defaultSize ?? (100 / node.children.length))
  const total = sizes.reduce((a, b) => a + b, 0) || node.children.length
  let acc = 0
  for (let i = 0; i < node.children.length; i++) {
    const frac0 = acc / total, len = sizes[i]! / total
    acc += sizes[i]!
    const cr: FlowRect = horizontal
      ? { x: rect.x + frac0 * rect.w, y: rect.y, w: len * rect.w, h: rect.h }
      : { x: rect.x, y: rect.y + frac0 * rect.h, w: rect.w, h: len * rect.h }
    collectLeaves(node.children[i]!, cr, [...path, i], out)
  }
}
export function snapIntent(movedNode: LayoutNode, pos: { x: number, y: number }, others: FlowNode[]): SnapIntent | null {
  const md = sizeOf(movedNode)
  const cx = pos.x + md.width / 2
  const cy = pos.y + md.height / 2
  // 1) PANEDROP: the drag OVERLAPS a target (≥35% of the dragged area) → drop beside the PANE under the
  // cursor. Find the leaf pane the cursor (clamped into the target) sits in, then the side from which
  // quadrant of that pane the cursor is over — so you can add to ANY edge of ANY pane, incl. the right
  // of a pane that lives in a vertical stack (no pre-existing seam needed). A lone block is one pane
  // (path []). (#972 — replaces the seam-only insert.)
  const dl = pos.x, dr = pos.x + md.width, dt = pos.y, db = pos.y + md.height
  for (const o of others) {
    const node = o.data.node
    const ts = sizeOf(node)
    const tx = o.position.x, ty = o.position.y
    const ox = Math.max(0, Math.min(dr, tx + ts.width) - Math.max(dl, tx))
    const oy = Math.max(0, Math.min(db, ty + ts.height) - Math.max(dt, ty))
    if ((ox * oy) / (md.width * md.height) < 0.35) continue // not enough over this node → try edge-snap
    const ccx = clamp(cx, tx, tx + ts.width), ccy = clamp(cy, ty, ty + ts.height)
    const leaves: { path: number[], rect: FlowRect }[] = []
    collectLeaves(node, { x: tx, y: ty, w: ts.width, h: ts.height }, [], leaves)
    // The pane containing the (clamped) cursor; else the nearest by centre.
    let hit = leaves.find(l => ccx >= l.rect.x && ccx <= l.rect.x + l.rect.w && ccy >= l.rect.y && ccy <= l.rect.y + l.rect.h)
    if (!hit) {
      let bestD = Infinity
      for (const l of leaves) {
        const d = Math.hypot(ccx - (l.rect.x + l.rect.w / 2), ccy - (l.rect.y + l.rect.h / 2))
        if (d < bestD) { bestD = d; hit = l }
      }
    }
    if (!hit) continue
    const lr = hit.rect
    const relx = (ccx - (lr.x + lr.w / 2)) / lr.w
    const rely = (ccy - (lr.y + lr.h / 2)) / lr.h
    const edge: SnapEdge = Math.abs(relx) >= Math.abs(rely) ? (relx >= 0 ? 'right' : 'left') : (rely >= 0 ? 'bottom' : 'top')
    const rect = { left: ((lr.x - tx) / ts.width) * 100, top: ((lr.y - ty) / ts.height) * 100, width: (lr.w / ts.width) * 100, height: (lr.h / ts.height) * 100 }
    return { kind: 'panedrop', target: o, paneDrop: { path: hit.path, edge, rect } }
  }
  // 2) EDGE: proximity side-snap — merge onto the outer edge of a NEARBY (non-overlapping) card.
  const s = snapAt(movedNode, pos, others)
  return s ? { kind: 'edge', target: s.target, edge: s.edge } : null
}

// "As placed" — positional infer over the canvas nodes. Each node carries its own
// `data.node` (a leaf, or a snapped split): 1 node → its node IS the root; many → a split
// whose axis is inferred from the spread, ordered along it, each node's layout preserved.
export function inferPositional(ns: FlowNode[]): LayoutTree | null {
  if (!ns.length) return null
  if (ns.length === 1) return { renderer: 'panes', root: ns[0]!.data.node }
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a)
  const horizontal = spread(ns.map(n => n.position.x)) >= spread(ns.map(n => n.position.y))
  const ordered = [...ns].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y))
  return {
    renderer: 'panes',
    root: {
      type: 'split',
      direction: horizontal ? 'horizontal' : 'vertical',
      children: ordered.map(n => ({ ...n.data.node, defaultSize: Math.round((100 / ordered.length) * 10) / 10 })),
    },
  }
}

/** The union box of every node's KNOWN geometry (position + footprint size) — NOT Vue Flow's
 *  measured `.vue-flow__node` wrapper, which is smaller than our overflowing card. */
export function boardBounds(ns: FlowNode[]): { x: number, y: number, width: number, height: number } | null {
  if (!ns.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of ns) {
    const s = sizeOf(n.data.node)
    minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + s.width); maxY = Math.max(maxY, n.position.y + s.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** A clear spot to the RIGHT of every existing node (never under one), so a freshly added block
 *  lands in the open, not hidden behind a wide layout. Uses real footprints, not a fixed stride. */
export function clearSpot(ns: FlowNode[]): { x: number, y: number } {
  if (!ns.length) return { x: 60, y: 140 }
  let maxRight = -Infinity, topY = Infinity
  for (const n of ns) {
    const s = sizeOf(n.data.node)
    maxRight = Math.max(maxRight, n.position.x + s.width)
    topY = Math.min(topY, n.position.y)
  }
  return { x: Math.round(maxRight + 100), y: Math.round(topY) }
}
