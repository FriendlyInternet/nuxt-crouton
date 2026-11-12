import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { isSubtreeCollapsed, partitionCollapsed } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { deriveSizing } from '@fyit/crouton-layout/app/utils/layout-viability'

/**
 * Board visible-only view (#3828): the board hides panes at a breakpoint when it renders
 * them, so its stack check, pane floors and sizes must read the visible tree too — the
 * same `partitionCollapsed` view the served page renders from.
 */

/** The subtree with every hidden pane removed (null when nothing shows). */
export function visibleSubtree(node: LayoutNode, hidden: Set<string>): LayoutNode | null {
  return partitionCollapsed(node, [...hidden]).visible
}

/**
 * The width (px) below which a horizontal split stacks on the board — the visible panes'
 * soft floor. 0 (never stacks) for a vertical split or one with ≤ 1 visible child.
 */
export function boardStackThreshold(
  split: LayoutNode,
  hidden: Set<string>,
  registry: CroutonLayoutBlockRegistry,
): number {
  if (split.type !== 'split' || split.direction !== 'horizontal') return 0
  const visibleCount = split.children.filter(c => !isSubtreeCollapsed(c, hidden)).length
  if (visibleCount <= 1) return 0
  const view = visibleSubtree(split, hidden)
  if (!view) return 0
  return Math.round(deriveSizing(view, registry).softMinWidth)
}

/** The visible children's default sizes, scaled to add up to 100 (render-only). */
export function visibleDefaultSizes(children: LayoutNode[]): number[] {
  const n = children.length
  if (n === 0) return []
  const raw = children.map(c => c.defaultSize ?? 100 / n)
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum <= 0) return raw.map(() => 100 / n)
  return raw.map(s => (s / sum) * 100)
}

/**
 * Map reka's visible-only size list (sums to 100) back onto ALL children: `undefined` at
 * hidden indices, visible sizes scaled into the share the visible children hold in the
 * stored sizes — so the stored total stays 100 and a hidden pane keeps its share.
 */
export function toChildSizes(
  children: LayoutNode[],
  visibleIdx: number[],
  sizes: number[],
): (number | undefined)[] {
  const n = children.length
  const share = visibleIdx.reduce((acc, i) => acc + (children[i]?.defaultSize ?? 100 / n), 0)
  const out: (number | undefined)[] = Array.from({ length: n }, () => undefined)
  visibleIdx.forEach((i, k) => {
    const s = sizes[k]
    if (s !== undefined) out[i] = (s * share) / 100
  })
  return out
}
