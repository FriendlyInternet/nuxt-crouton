/**
 * Groups on the board (#3906).
 *
 * The board edits a WORKING tree in which every group is an ordinary `split` that
 * carries a marker (`GROUP_KEY`). The saved tree keeps today's `nested` shape — the
 * served page renders it unchanged. Two pure functions convert, at exactly two places
 * on the page: `expandGroups` when the tree is read, `collapseGroups` when it is
 * written. Because every package edit copies a split with `{ ...split, children }`,
 * the marker survives joins, resizes and removals; a group left with one block is
 * replaced by that block, so it stops being a group.
 *
 * Rules: a middle drop never makes a group inside a group (it lands beside the
 * target instead), and a move between two blocks of the same group stays inside it.
 */
import type { LayoutNode, LayoutSplit, LayoutTree, LayoutNested, LayoutNodeBase } from '@fyit/crouton-core/app/types/layout'
import {
  applyPaneDrop, detachNode, getNode,
  type NodePath, type DropEdge,
} from '@fyit/crouton-layout/app/utils/layout-edit'

export const GROUP_KEY = '__boardGroup' as const

/** What a working-tree group remembers of its saved `nested` node. */
export interface BoardGroupMarker {
  label?: string
  /** The nested node's layout without `root` (renderer, breakpoints, … kept untouched). */
  layout: Omit<LayoutTree, 'root'>
}
export type BoardGroup = LayoutSplit & { [GROUP_KEY]: BoardGroupMarker }

const OUTER_KEYS = ['size', 'defaultSize', 'minSize'] as const

/** The outer fields (`size`, `defaultSize`, `minSize`) that are set on `node`. */
function outerOf(node: LayoutNode): Partial<LayoutNodeBase> {
  const out: Record<string, unknown> = {}
  for (const k of OUTER_KEYS) if (node[k] !== undefined) out[k] = node[k]
  return out as Partial<LayoutNodeBase>
}

/** A shallow copy of `node` without its outer fields. */
function stripOuter<T extends LayoutNode>(node: T): T {
  const copy = { ...node }
  for (const k of OUTER_KEYS) delete copy[k]
  return copy
}

const isPrefix = (a: NodePath, b: NodePath): boolean => a.length <= b.length && a.every((v, i) => v === b[i])

/** A split that carries the group marker. */
export function isGroup(node: LayoutNode | null | undefined): node is BoardGroup {
  return !!node && node.type === 'split' && !!(node as Partial<BoardGroup>)[GROUP_KEY]
}

function containsGroup(node: LayoutNode): boolean {
  if (isGroup(node)) return true
  return node.type === 'split' && node.children.some(containsGroup)
}

/** Saved tree → working tree: every `nested` becomes a marked split. */
export function expandGroups(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.type === 'split') return { ...node, children: node.children.map(expandGroups) }
  const { root, ...layout } = node.layout
  const inner = expandGroups(root)
  if (inner.type === 'split' && !isGroup(inner)) {
    const marker: BoardGroupMarker = { ...(node.label !== undefined ? { label: node.label } : {}), layout }
    return { ...stripOuter(inner), ...outerOf(node), [GROUP_KEY]: marker } as BoardGroup
  }
  // A group of one thing is that thing.
  return { ...stripOuter(inner), ...outerOf(node) }
}

/** Working tree → saved tree: every marked split becomes a `nested` node again. */
export function collapseGroups(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.type === 'nested') return { ...node, layout: { ...node.layout, root: collapseGroups(node.layout.root) } }
  const children = node.children.map(collapseGroups)
  if (!isGroup(node)) return { ...node, children }
  const { [GROUP_KEY]: marker, ...split } = node
  const inner: LayoutSplit = { ...stripOuter(split as LayoutSplit), children }
  const nested: LayoutNested = {
    type: 'nested',
    layout: { ...marker.layout, root: inner } as LayoutTree,
    ...(marker.label !== undefined ? { label: marker.label } : {}),
    ...outerOf(node),
  }
  return nested
}

/** Immutable replace of the node at `path` (no collapse, no rescale). */
function setAt(root: LayoutNode, path: NodePath, next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  if (root.type !== 'split') return root
  const [head, ...rest] = path
  const child = root.children[head!]
  if (!child) return root
  const children = root.children.slice()
  children[head!] = setAt(child, rest, next)
  return { ...root, children }
}

/** True when a proper ancestor of `path` is a group. */
function insideGroup(root: LayoutNode, path: NodePath): boolean {
  for (let k = 0; k < path.length; k++) if (isGroup(getNode(root, path.slice(0, k)))) return true
  return false
}

/**
 * The middle drop: `node` and the target at `targetPath` become a new group — unless
 * that would put a group in a group (the target is inside / is / holds a group, or
 * `node` is / holds one), in which case `node` lands beside the target.
 */
export function groupNodes(root: LayoutNode, targetPath: NodePath, node: LayoutNode): LayoutNode {
  const target = getNode(root, targetPath)
  if (!target) return root
  if (insideGroup(root, targetPath) || containsGroup(target) || containsGroup(node)) {
    return applyPaneDrop(root, { path: targetPath, edge: 'right' }, node)
  }
  const group: BoardGroup = {
    type: 'split',
    direction: 'horizontal',
    children: [stripOuter(target), stripOuter(node)],
    ...outerOf(target),
    [GROUP_KEY]: { layout: { renderer: 'panes' } },
  }
  return setAt(root, targetPath, group)
}

/** Remove the group marker from the split at `path`; anything else → the same root. */
export function ungroupAt(root: LayoutNode, path: NodePath): LayoutNode {
  const node = getNode(root, path)
  if (!isGroup(node)) return root
  const { [GROUP_KEY]: _marker, ...plain } = node
  return setAt(root, path, plain as LayoutSplit)
}

/** Lift `from` out and land it at `to`'s `edge` — the same root when nothing moves. */
function moveRaw(root: LayoutNode, from: NodePath, to: NodePath, edge: DropEdge): LayoutNode {
  const { root: lifted, detached, trackedPath } = detachNode(root, from, to)
  if (!detached || !lifted || !trackedPath) return root
  return edge === 'center'
    ? groupNodes(lifted, trackedPath, detached)
    : applyPaneDrop(lifted, { path: trackedPath, edge }, detached)
}

/**
 * Move the pane at `from` onto `to`'s `edge` (the board's pane drop). A move between
 * two blocks of the same group happens inside that group (a centre drop there counts
 * as `right`), so lifting one block out of a two-block group doesn't dissolve it.
 * Returns the SAME `root` object when nothing moves.
 */
export function movePane(root: LayoutNode, from: NodePath, to: NodePath, edge: DropEdge): LayoutNode {
  if (isPrefix(from, to)) return root // onto itself or into its own subtree
  if (!getNode(root, from) || !getNode(root, to)) return root

  // The deepest group that is a proper ancestor of both paths.
  let common = 0
  const max = Math.min(from.length, to.length) - 1
  while (common < max && from[common] === to[common]) common++
  for (let k = Math.min(common, max); k >= 0; k--) {
    const gPath = from.slice(0, k)
    const group = getNode(root, gPath)
    if (!isGroup(group)) continue
    const moved = moveRaw(group, from.slice(k), to.slice(k), edge === 'center' ? 'right' : edge)
    if (moved === group) return root
    const restored = moved.type === 'split' && !isGroup(moved)
      ? { ...stripOuter(moved), ...outerOf(group), [GROUP_KEY]: group[GROUP_KEY] } as BoardGroup
      : { ...stripOuter(moved), ...outerOf(group) }
    return setAt(root, gPath, restored)
  }
  return moveRaw(root, from, to, edge)
}
