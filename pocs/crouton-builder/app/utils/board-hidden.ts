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
  open: (blockId: string) => void
}

export const BOARD_HIDDEN_KEY: InjectionKey<HiddenBlocksApi> = Symbol('board-hidden')

/** Walk a resolved root and list the leaves whose blockId is in `hidden`. */
export function collectHidden(
  root: LayoutNode | null,
  hidden: Set<string>,
  describe: (blockId: string) => { label: string, icon: string },
): HiddenItem[] {
  const out: HiddenItem[] = []
  const seen = new Set<string>()
  function walk(node: LayoutNode) {
    if (node.type === 'leaf') {
      if (hidden.has(node.blockId) && !seen.has(node.blockId)) {
        seen.add(node.blockId)
        const { label, icon } = describe(node.blockId)
        out.push({ blockId: node.blockId, label, icon, leaf: node, recipe: normalizeCollapseRecipe(node.collapse) })
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
