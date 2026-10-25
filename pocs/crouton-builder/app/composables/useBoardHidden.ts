/**
 * Hidden blocks at a width (#2418): which blocks the active breakpoint hides,
 * the trigger items they become, and the two edits — hide/show at this width,
 * change a block's trigger/reveal recipe.
 */
import type { Ref } from 'vue'
import type { LayoutNode, LayoutTree, LayoutLeaf, LayoutCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import { normalizeCollapseRecipe } from '@fyit/crouton-core/app/types/layout'
import type { CroutonLayoutBlockRegistry } from '@fyit/crouton-core/app/types/layout-block'
import { resolveLayoutAtWidth, patchBreakpoint, isSubtreeCollapsed, type ResolvedLayout } from '@fyit/crouton-layout/app/utils/layout-responsive'
import { setCollapseRecipe } from '@fyit/crouton-layout/app/utils/layout-edit'
import { collectHidden, collapsePlacement, type HiddenItem } from '~/utils/board-hidden'

export function useBoardHidden(opts: {
  tree: Ref<LayoutTree | null>
  resolved: Ref<ResolvedLayout | null>
  root: Ref<LayoutNode | null>
  blocks: Ref<CroutonLayoutBlockRegistry>
  /** The breakpoint an edit lands on (null = none yet at this width). */
  writeTarget: Ref<number | null>
  effWidth: Ref<number>
  /** Replace the current variant's tree. */
  setTree: (tree: LayoutTree) => void
  /** Write an edited root (the host decides base vs breakpoint). */
  writeRoot: (root: LayoutNode) => void
}) {
  const hiddenSet = computed(() => new Set(opts.resolved.value?.collapsed ?? []))
  const hiddenItems = computed<HiddenItem[]>(() => collectHidden(opts.root.value, hiddenSet.value, id => ({
    label: opts.blocks.value[id]?.name ?? id,
    icon: opts.blocks.value[id]?.icon ?? 'i-lucide-box',
  })))
  const navItems = computed(() => hiddenItems.value.filter(i => collapsePlacement(i.recipe) === 'nav'))
  const allHidden = computed(() => !!opts.root.value && isSubtreeCollapsed(opts.root.value, hiddenSet.value))

  /**
   * Hide/show a block at this width. Lives on a breakpoint — the one in view, or
   * a new one at this width. Flips relative to what is SHOWN (possibly inherited),
   * and pins higher breakpoints that never stated their own list, so hiding a block
   * on the phone can't leak into a desktop layout you already authored.
   */
  function toggleHidden(blockId: string) {
    const tree = opts.tree.value
    if (!tree) return
    const w = opts.writeTarget.value ?? opts.effWidth.value
    const hasBp = (tree.breakpoints ?? []).some(b => b.minWidth === w)
    let next = hasBp ? tree : patchBreakpoint(tree, w, { collapsed: [...hiddenSet.value] })
    for (const b of next.breakpoints ?? []) {
      if (b.minWidth > w && b.collapsed === undefined)
        next = patchBreakpoint(next, b.minWidth, { collapsed: resolveLayoutAtWidth(tree, b.minWidth).collapsed })
    }
    const shown = new Set(hiddenSet.value)
    if (shown.has(blockId)) shown.delete(blockId)
    else shown.add(blockId)
    opts.setTree(patchBreakpoint(next, w, { collapsed: [...shown] }))
  }

  /** Change where a block's trigger lives / how it opens. */
  function setRecipe(leaf: LayoutLeaf, patch: Partial<LayoutCollapseRecipe>) {
    if (!opts.root.value) return
    const next = normalizeCollapseRecipe({ ...normalizeCollapseRecipe(leaf.collapse), ...patch })
    opts.writeRoot(setCollapseRecipe(opts.root.value, leaf.blockId, next))
  }

  return { hiddenSet, hiddenItems, navItems, allHidden, toggleHidden, setRecipe }
}
