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
import { findNodePath, type NodePath } from '@fyit/crouton-layout/app/utils/layout-edit'
import { collectHidden, collapsePlacement, paneKey, type HiddenItem } from '~/utils/board-hidden'

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
  function toggleHidden(key: string) {
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
    if (shown.has(key)) shown.delete(key)
    else shown.add(key)
    opts.setTree(patchBreakpoint(next, w, { collapsed: [...shown] }))
  }

  /** Change where THIS pane's trigger lives / how it opens (by pane, not by block type). */
  function setRecipe(leaf: LayoutLeaf, patch: Partial<LayoutCollapseRecipe>) {
    const root = opts.root.value
    if (!root) return
    const path = findNodePath(root, leaf)
    if (!path) return
    const next = normalizeCollapseRecipe({ ...normalizeCollapseRecipe(leaf.collapse), ...patch })
    opts.writeRoot(replaceLeafAt(root, path, { ...leaf, collapse: next }))
  }

  return { hiddenSet, hiddenItems, navItems, allHidden, toggleHidden, setRecipe, paneKey }
}

/** Immutable replace of the node at `path`. */
function replaceLeafAt(root: LayoutNode, path: NodePath, next: LayoutNode): LayoutNode {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (root.type === 'split') return { ...root, children: root.children.map((c, i) => (i === head ? replaceLeafAt(c, rest, next) : c)) }
  if (root.type === 'nested') return { ...root, layout: { ...root.layout, root: replaceLeafAt(root.layout.root, path, next) } }
  return root
}

