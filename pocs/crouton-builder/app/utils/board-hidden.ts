/**
 * Hidden blocks as navigation (#2418).
 *
 * At a width, the blocks hidden by the active breakpoint don't vanish: each
 * becomes a trigger — on its edge, or collected by the page's nav/toolbar
 * blocks — that opens the block as a slideover / sheet / modal / page. The
 * page provides the current width's hidden items + an `open` handler; the nav
 * blocks inject them and render the items.
 */
import type { InjectionKey, Ref } from 'vue'
import type { LayoutLeaf, LayoutCollapseRecipe, LayoutNode } from '@fyit/crouton-core/app/types/layout'
import { normalizeCollapseRecipe, collapsePlacement, collapseReveal } from '@fyit/crouton-core/app/types/layout'

export interface HiddenItem {
  /** The pane's key: its own id when it has one (#2490), else its block id. */
  key: string
  blockId: string
  label: string
  icon: string
  leaf: LayoutLeaf
  recipe: LayoutCollapseRecipe
}

export interface HiddenBlocksApi {
  /** Hidden blocks whose trigger lives in the nav (what a nav block renders). */
  navItems: Ref<HiddenItem[]>
  /** All hidden blocks at this width (edge-placed ones draw their own trigger). */
  items: Ref<HiddenItem[]>
  open: (key: string) => void
}

/** The handle a hidden list refers to: the pane's own id, or the block id on older trees. */
export function paneKey(leaf: LayoutLeaf): string {
  return leaf.id ?? leaf.blockId
}
/** Hidden when the list names this pane or its block (same rule as the package resolver). */
export function isPaneHidden(leaf: LayoutLeaf, hidden: Set<string>): boolean {
  return (!!leaf.id && hidden.has(leaf.id)) || hidden.has(leaf.blockId)
}

export const BOARD_HIDDEN_KEY: InjectionKey<HiddenBlocksApi> = Symbol('board-hidden')

/** Walk a resolved root and list every hidden pane (one item per pane). */
export function collectHidden(
  root: LayoutNode | null,
  hidden: Set<string>,
  describe: (blockId: string) => { label: string, icon: string },
): HiddenItem[] {
  const out: HiddenItem[] = []
  const seen = new Set<string>()
  function walk(node: LayoutNode) {
    if (node.type === 'leaf') {
      const key = paneKey(node)
      if (isPaneHidden(node, hidden) && !seen.has(key)) {
        seen.add(key)
        const { label, icon } = describe(node.blockId)
        out.push({ key, blockId: node.blockId, label, icon, leaf: node, recipe: normalizeCollapseRecipe(node.collapse) })
      }
      return
    }
    if (node.type === 'nested') return walk(node.layout.root)
    node.children.forEach(walk)
  }
  if (root) walk(root)
  return out
}

export { collapsePlacement, collapseReveal }
