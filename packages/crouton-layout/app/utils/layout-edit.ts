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
import type { LayoutNode, LayoutLeaf, LayoutSplit } from '@fyit/crouton-core/app/types/layout'
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
