/**
 * Pure layout-tree edit operations (Sprint 3, #706).
 *
 * The editable `CroutonLayout` surface keeps the `LayoutTree` as its single
 * source of truth: every gesture (drop a block, split a pane, nest, remove,
 * resize, edit config) is one of the immutable transforms below. They're pure
 * (no Vue, no DOM) so the compose loop is unit-testable without a browser — the
 * component just swaps in the returned root.
 *
 * A node is addressed by a `NodePath`: the array of child indices from the root
 * (root itself is `[]`). All functions return a NEW root (structural copies on
 * the touched spine) and never mutate their input.
 */
import type { LayoutNode, LayoutLeaf, LayoutSplit, LayoutNested, LayoutTree, LayoutCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockDefinition } from '@fyit/crouton-core/app/types/layout-block'

export type NodePath = number[]
/** Which edge of a target pane a block was dropped on → split direction + order. */
export type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Resolve the node at `path`, or null if the path doesn't exist. */
export function getNode(root: LayoutNode | null, path: NodePath): LayoutNode | null {
  let node: LayoutNode | null = root
  for (const i of path) {
    if (!node || node.type !== 'split' || !node.children[i]) return null
    node = node.children[i]!
  }
  return node
}

/** Build a fresh leaf for `blockId`, seeding size from the block's contract. */
export function makeLeaf(
  blockId: string,
  def?: CroutonLayoutBlockDefinition,
): LayoutLeaf {
  return {
    type: 'leaf',
    blockId,
    ...(def?.defaultSize !== undefined ? { defaultSize: def.defaultSize } : {}),
  }
}

/** Replace the node at `path` with `next` (or remove it when `next` is null). */
function replaceAt(
  root: LayoutNode,
  path: NodePath,
  next: LayoutNode | null,
): LayoutNode | null {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (root.type !== 'split') return root
  const child = root.children[head!]
  if (!child) return root

  const replaced = replaceAt(child, rest, next)
  const children = root.children.slice()
  if (replaced === null) {
    children.splice(head!, 1)
    // A split with a single survivor collapses into that survivor, preserving
    // the parent's own size so the layout doesn't jump.
    if (children.length === 1) {
      const sole = children[0]!
      return { ...sole, ...sizeOf(root) }
    }
    if (children.length === 0) return null
  }
  else {
    children[head!] = replaced
  }
  return { ...root, children }
}

/** Pull just the size fields off a node (for preserving them across rewrites). */
function sizeOf(node: LayoutNode): { defaultSize?: number, minSize?: number } {
  return {
    ...(node.defaultSize !== undefined ? { defaultSize: node.defaultSize } : {}),
    ...(node.minSize !== undefined ? { minSize: node.minSize } : {}),
  }
}

/** A shallow copy of `node` with its outer size shed (so a wrapping split owns it). */
function stripSize(node: LayoutNode): LayoutNode {
  const copy = { ...node }
  delete (copy as LayoutNode).defaultSize
  delete (copy as LayoutNode).minSize
  return copy
}

/**
 * Drop a block onto the pane at `path`.
 * - `center` replaces the leaf's block in place (a swap).
 * - an edge wraps the target node in a new 2-child split: left/right →
 *   horizontal, top/bottom → vertical; left/top put the new block first.
 * Dropping onto an empty tree (`root === null`) seeds a single leaf.
 */
export function dropBlock(
  root: LayoutNode | null,
  path: NodePath,
  blockId: string,
  edge: DropEdge,
  def?: CroutonLayoutBlockDefinition,
): LayoutNode {
  if (!root) return makeLeaf(blockId, def)

  const target = getNode(root, path)
  if (!target) return root

  if (edge === 'center') {
    // Swap the block on a leaf; on a split, center-drop is a no-op (ambiguous).
    if (target.type !== 'leaf') return root
    const swapped: LayoutLeaf = { ...target, blockId, config: undefined }
    return replaceAt(root, path, swapped) ?? root
  }

  const direction = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
  const newLeaf = makeLeaf(blockId, def)
  const first = edge === 'left' || edge === 'top'
  // The wrapped target keeps its block but sheds its outer size (the new split
  // inherits it), so the two children share the pane evenly by default.
  const wrapped: LayoutNode = { ...target }
  delete (wrapped as LayoutNode).defaultSize
  delete (wrapped as LayoutNode).minSize
  const split: LayoutSplit = {
    type: 'split',
    direction,
    children: first ? [newLeaf, wrapped] : [wrapped, newLeaf],
    ...sizeOf(target),
  }
  return replaceAt(root, path, split) ?? root
}

/** Remove the pane at `path`; returns the new root, or null if it emptied out. */
export function removeNode(root: LayoutNode | null, path: NodePath): LayoutNode | null {
  if (!root || path.length === 0) return null
  return replaceAt(root, path, null)
}

/** Persist reka-ui resize results: set each child's `defaultSize` on a split. */
export function applySizes(
  root: LayoutNode,
  path: NodePath,
  sizes: number[],
): LayoutNode {
  const target = getNode(root, path)
  if (!target || target.type !== 'split') return root
  const children = target.children.map((c, i) =>
    sizes[i] !== undefined ? { ...c, defaultSize: sizes[i] } : c,
  )
  return replaceAt(root, path, { ...target, children }) ?? root
}

/** Set the per-block config on the leaf at `path`. */
export function setConfig(
  root: LayoutNode,
  path: NodePath,
  config: Record<string, unknown>,
): LayoutNode {
  const target = getNode(root, path)
  if (!target || target.type !== 'leaf') return root
  return replaceAt(root, path, { ...target, config }) ?? root
}

/**
 * Set a leaf's collapse recipe (#852) — how it tucks when collapsed (edge + affordance).
 * Keyed by `blockId` (how the editor selects a pane), recursing into nested sub-layouts;
 * immutable, returns a new root. A pure helper so the recipe picker just swaps the tree.
 */
export function setCollapseRecipe(
  root: LayoutNode,
  blockId: string,
  recipe: LayoutCollapseRecipe,
): LayoutNode {
  function walk(node: LayoutNode): LayoutNode {
    if (node.type === 'leaf') return node.blockId === blockId ? { ...node, collapse: recipe } : node
    if (node.type === 'nested') return { ...node, layout: { ...node.layout, root: walk(node.layout.root) } }
    return { ...node, children: node.children.map(walk) }
  }
  return walk(root)
}

// --- Recursive nested layouts (WS2 #871) -----------------------------------
// A `nested` node embeds a whole sub-layout ("an app that is itself a layout").
// It is opaque to its parent's `NodePath` space — `getNode`/`replaceAt` stop at
// it because it isn't a `split` — so each layout is edited in its OWN path space,
// scoped to the level the zoom shell (WS1) has focused. To edit a sub-layout you
// pull it out with `getNestedLayout`, transform its root with the same functions,
// and write it back with `replaceNestedLayout`.

/** Build a `nested` node wrapping a sub-layout as an app boundary. */
export function makeNested(layout: LayoutTree, label?: string): LayoutNested {
  return { type: 'nested', layout, ...(label ? { label } : {}) }
}

/** Resolve the sub-layout hosted by the `nested` node at `path`, or null. */
export function getNestedLayout(root: LayoutNode | null, path: NodePath): LayoutTree | null {
  const target = getNode(root, path)
  return target && target.type === 'nested' ? target.layout : null
}

/** Replace the sub-layout on the `nested` node at `path` (no-op off a nested node). */
export function replaceNestedLayout(
  root: LayoutNode,
  path: NodePath,
  layout: LayoutTree,
): LayoutNode {
  const target = getNode(root, path)
  if (!target || target.type !== 'nested') return root
  return replaceAt(root, path, { ...target, layout }) ?? root
}

/**
 * List the `nested` apps reachable in THIS layout's path space (the zoom targets
 * for the semantic-zoom shell, WS1 #870). Recurses through `split` children but
 * STOPS at a `nested` node — its sub-layout is a separate path space you reach by
 * zooming in, not by addressing across the boundary.
 */
export function findNestedNodes(
  root: LayoutNode | null,
  base: NodePath = [],
): { path: NodePath, label?: string }[] {
  if (!root) return []
  if (root.type === 'nested') return [{ path: base, ...(root.label ? { label: root.label } : {}) }]
  if (root.type === 'split') return root.children.flatMap((c, i) => findNestedNodes(c, [...base, i]))
  return []
}

// --- Compose gestures (WS4 #873) -------------------------------------------
// Direct-manipulation gestures (magnetic snap / rearrange / detach / dwell-to-drop)
// expressed as pure transforms on the same immutable tree. The *where* (which pane
// edge) comes from `layout-snap`'s geometry; these apply the *what*. The composable
// wires pointer drags to them; they stay pure so the compose loop is unit-testable.

/**
 * Drop an existing NODE onto the pane at `path` along `edge` — the snap/rearrange
 * primitive (`dropBlock` makes a fresh leaf; this inserts a whole node, so it can move
 * a subtree or snap a free app in). `center` swaps the target node wholesale. The
 * dropped node sheds its outer size so the new pair shares the pane.
 */
export function dropNode(
  root: LayoutNode | null,
  path: NodePath,
  node: LayoutNode,
  edge: DropEdge,
): LayoutNode {
  if (!root) return node
  const target = getNode(root, path)
  if (!target) return root

  if (edge === 'center') return replaceAt(root, path, node) ?? root

  const direction = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical'
  const first = edge === 'left' || edge === 'top'
  const wrapped = stripSize(target)
  const dropped = stripSize(node)
  const split: LayoutSplit = {
    type: 'split',
    direction,
    children: first ? [dropped, wrapped] : [wrapped, dropped],
    ...sizeOf(target),
  }
  return replaceAt(root, path, split) ?? root
}

/**
 * Detach the node at `path` — pop it out to a free card. Returns the removed node and
 * the remaining tree (the parent split collapses to its survivor, as with `removeNode`).
 * Detaching the root empties the tree. A bad path detaches nothing.
 */
export function detachNode(
  root: LayoutNode | null,
  path: NodePath,
): { root: LayoutNode | null, detached: LayoutNode | null } {
  const detached = getNode(root, path)
  if (!root || !detached) return { root, detached: null }
  return { root: removeNode(root, path), detached }
}

/** The path to `node` (by reference) within `root`, or null if it isn't present. */
export function findNodePath(root: LayoutNode | null, node: LayoutNode): NodePath | null {
  if (!root) return null
  if (root === node) return []
  if (root.type === 'split') {
    for (let i = 0; i < root.children.length; i++) {
      const sub = findNodePath(root.children[i]!, node)
      if (sub) return [i, ...sub]
    }
  }
  return null
}

const isPrefix = (a: NodePath, b: NodePath): boolean => a.length <= b.length && a.every((v, i) => v === b[i])

const MOVE_MARK = '__croutonMoveTarget'
type Marked = LayoutNode & { [MOVE_MARK]?: true }

/** Copy the spine to `path`, tagging the node there with a transient marker. */
function cloneMarking(node: LayoutNode, path: NodePath): LayoutNode {
  if (path.length === 0) return { ...node, [MOVE_MARK]: true } as Marked
  if (node.type !== 'split') return node
  const [head, ...rest] = path
  const children = node.children.slice()
  if (children[head!]) children[head!] = cloneMarking(children[head!]!, rest)
  return { ...node, children }
}

/** Path to the marked node after the detach reshaped the tree, or null. */
function findMark(node: LayoutNode | null, base: NodePath = []): NodePath | null {
  if (!node) return null
  if ((node as Marked)[MOVE_MARK]) return base
  if (node.type === 'split') {
    for (let i = 0; i < node.children.length; i++) {
      const r = findMark(node.children[i]!, [...base, i])
      if (r) return r
    }
  }
  if (node.type === 'nested') return findMark(node.layout.root, base) ? base : null
  return null
}

/** Strip the transient marker everywhere (the result is a clean tree). */
function unmark(node: LayoutNode): LayoutNode {
  const copy = { ...node } as Marked
  delete copy[MOVE_MARK]
  if (copy.type === 'split') copy.children = copy.children.map(unmark)
  if (copy.type === 'nested') copy.layout = { ...copy.layout, root: unmark(copy.layout.root) }
  return copy
}

/**
 * Rearrange: move the node at `fromPath` to `toPath`'s `edge`. We mark the target,
 * detach the source (which may collapse a 2-child parent and rewrite paths), re-find
 * the target by its marker — robust to that collapse — then drop the moving node there.
 * No-op when moving a node onto itself or into its own subtree.
 */
export function moveNode(
  root: LayoutNode | null,
  fromPath: NodePath,
  toPath: NodePath,
  edge: DropEdge,
): LayoutNode | null {
  if (!root || fromPath.length === 0) return root
  if (isPrefix(fromPath, toPath)) return root // onto itself or a descendant
  const moving = getNode(root, fromPath)
  if (!moving || !getNode(root, toPath)) return root

  const marked = cloneMarking(root, toPath)
  const { root: detachedRoot } = detachNode(marked, fromPath)
  if (!detachedRoot) return root
  const targetPath = findMark(detachedRoot)
  if (!targetPath) return root
  return unmark(dropNode(detachedRoot, targetPath, moving, edge))
}

/**
 * Dwell-to-drop-inside: drop `node` *inside* the pane at `path`, creating a nested app
 * (WS2 nesting). On a leaf/split target it wraps the target + node into a new `nested`
 * sub-layout (split). On an existing `nested` target it appends into that sub-layout.
 * The new node inherits the target's slot size so the outer layout doesn't jump.
 */
export function nestInside(
  root: LayoutNode | null,
  path: NodePath,
  node: LayoutNode,
  label?: string,
): LayoutNode {
  if (!root) return root ?? node
  const target = getNode(root, path)
  if (!target) return root

  if (target.type === 'nested') {
    const inner = dropNode(target.layout.root, [], node, 'right')
    return replaceAt(root, path, { ...target, layout: { ...target.layout, root: inner } }) ?? root
  }

  const innerRoot: LayoutSplit = {
    type: 'split',
    direction: 'horizontal',
    children: [stripSize(target), stripSize(node)],
  }
  const nested: LayoutNested = { type: 'nested', layout: { renderer: 'panes', root: innerRoot }, ...(label ? { label } : {}), ...sizeOf(target) }
  return replaceAt(root, path, nested) ?? root
}
