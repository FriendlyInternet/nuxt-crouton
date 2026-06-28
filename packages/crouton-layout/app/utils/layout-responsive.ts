/**
 * The explicit responsiveness layer (WS5, #874) — pure precedence logic for
 * authored breakpoints, the companion to the intrinsic container-query layer the
 * renderer applies in CSS.
 *
 * Two complementary layers make a layout responsive:
 *  - *Intrinsic* — every region reflows to ITS OWN width via container queries,
 *    recursively (the block-authoring `@container` rule; lives in the renderer's
 *    CSS, not here). It needs no data.
 *  - *Explicit* — `LayoutTree.breakpoints`: min-width checkpoints authored "by
 *    demonstration" that LOCK UPWARD. This module resolves them.
 *
 * **Precedence model** (the contract under Test sign-off, #774): at a container
 * width `W`, each overridable field is resolved INDEPENDENTLY, last-wins — it
 * takes the value from the *largest* breakpoint whose `minWidth <= W` that
 * defines it, otherwise the base default. So `collapsed` set at 600px and a
 * `variant` set at 1024px compose without re-stating each other; and a later
 * breakpoint that redefines a field fully replaces it (a snapshot, not a merge),
 * so `collapsed: []` at desktop genuinely means "nothing collapsed here".
 *
 * Intrinsic vs explicit: the explicit layer picks the macro arrangement (which
 * panes, what's collapsed, which widget variant) for the layout's own container
 * width; the intrinsic layer then reflows the content INSIDE each chosen pane.
 * They compose — explicit selects structure, intrinsic reflows within it.
 *
 * Pure (no Vue, no DOM) so the precedence is unit-testable without a browser.
 */
import type { LayoutBreakpoint, LayoutCollapseRecipe, LayoutCollapseStyle, LayoutNode, LayoutTree } from '@fyit/crouton-core/app/types/layout'
import { DEFAULT_COLLAPSE_STYLE, isLayoutCollapseStyle, normalizeCollapseRecipe } from '@fyit/crouton-core/app/types/layout'

/** The effective layout view at one container width — what the renderer draws. */
export interface ResolvedLayout {
  /** The arrangement to render (base root, or a breakpoint's `root` override). */
  root: LayoutNode
  /** `blockId`s collapsed to a gutter tab at this width. */
  collapsed: string[]
  /** Per-block widget variant overrides (`blockId` → variant) at this width. */
  variants: Record<string, string>
  /**
   * Resolved collapse motion (WS6, #875) for collapsed panes, if any active breakpoint
   * authored one. Stays faithful to what was authored (undefined when none) — consumers
   * call `normalizeCollapseStyle` to fold absent → `DEFAULT_COLLAPSE_STYLE`.
   */
  collapseStyle?: LayoutCollapseStyle
  /** The winning (largest active) checkpoint's `minWidth`, or null when on the base. */
  activeBreakpoint: number | null
}

/** Container width is the only axis; clamp junk (negative / NaN) to 0 → base. */
function clampWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? width : 0
}

/**
 * Fold a resolved/authored collapse-style value into a known `LayoutCollapseStyle`
 * (WS6, #875): a recognised style passes through; absent or unknown ⇒
 * `DEFAULT_COLLAPSE_STYLE` (`gutter-tabs`). The renderer always has a concrete motion.
 */
export function normalizeCollapseStyle(value: string | undefined): LayoutCollapseStyle {
  return isLayoutCollapseStyle(value) ? value : DEFAULT_COLLAPSE_STYLE
}

/**
 * Is every leaf under `node` in the collapsed set? Used by the in-place renderer to
 * decide whether a splitter panel should collapse and hand its space back to siblings:
 * a `split` only collapses when *all* its children are collapsed, so a half-collapsed
 * split keeps its slot. Recurses through nested sub-layouts. Empty set ⇒ false.
 */
export function isSubtreeCollapsed(node: LayoutNode, collapsedIds: Set<string>): boolean {
  if (collapsedIds.size === 0) return false
  if (node.type === 'leaf') return collapsedIds.has(node.blockId)
  if (node.type === 'nested') return isSubtreeCollapsed(node.layout.root, collapsedIds)
  return node.children.every(c => isSubtreeCollapsed(c, collapsedIds))
}

/**
 * Resolve the effective layout at a container width, applying the authored
 * breakpoints' min-width-locks-upward precedence over the base tree.
 */
export function resolveLayoutAtWidth(tree: LayoutTree, width: number): ResolvedLayout {
  const w = clampWidth(width)

  // Active = authored at or below this width; ascending so "largest" is last.
  const active = (tree.breakpoints ?? [])
    .filter(b => Number.isFinite(b.minWidth) && b.minWidth >= 0 && b.minWidth <= w)
    .slice()
    .sort((a, b) => a.minWidth - b.minWidth)

  // The largest active breakpoint that *defines* a given field wins it.
  function largestWith<T>(read: (b: LayoutBreakpoint) => T | undefined): T | undefined {
    for (let i = active.length - 1; i >= 0; i--) {
      const v = read(active[i]!)
      if (v !== undefined) return v
    }
    return undefined
  }

  const rootOverride = largestWith(b => b.root)
  const collapsed = largestWith(b => b.collapsed)
  const variants = largestWith(b => b.variants)
  const collapseStyle = largestWith(b => b.collapseStyle)

  return {
    root: rootOverride ?? tree.root,
    collapsed: collapsed ? [...collapsed] : [],
    variants: variants ? { ...variants } : {},
    ...(collapseStyle !== undefined ? { collapseStyle } : {}),
    activeBreakpoint: active.length ? active[active.length - 1]!.minWidth : null,
  }
}

/** A pane that's been collapsed out of the tree → rendered as a tucked affordance. */
export interface CollapsedPane {
  blockId: string
  /** The enclosing nested-app label, when the block lives inside a `nested` node. */
  label?: string
  /** How this pane tucks (#852) — edge + affordance, normalized from the leaf's `collapse`. */
  recipe: LayoutCollapseRecipe
}

/** Pull the size fields off a node (preserved when a single survivor collapses up). */
function sizeOf(node: LayoutNode): { defaultSize?: number, minSize?: number } {
  return {
    ...(node.defaultSize !== undefined ? { defaultSize: node.defaultSize } : {}),
    ...(node.minSize !== undefined ? { minSize: node.minSize } : {}),
  }
}

/**
 * Split a layout into the still-visible tree and the panes that were collapsed
 * (for a gutter rail). A leaf whose `blockId` is in `collapsedIds` is pulled out;
 * a split with a single survivor collapses up into that survivor (mirroring the
 * edit transforms), so the visible tree stays a clean, gap-free layout. Recurses
 * into `nested` sub-layouts, tagging any collapsed block found inside with the
 * enclosing app's label. Returns `visible: null` when everything collapsed.
 *
 * No-op (returns the input root by reference) when `collapsedIds` is empty.
 */
export function partitionCollapsed(
  root: LayoutNode | null,
  collapsedIds: string[],
): { visible: LayoutNode | null, collapsed: CollapsedPane[] } {
  if (!root || collapsedIds.length === 0) return { visible: root, collapsed: [] }
  const set = new Set(collapsedIds)
  const collapsed: CollapsedPane[] = []

  function walk(node: LayoutNode, contextLabel?: string): LayoutNode | null {
    if (node.type === 'leaf') {
      if (set.has(node.blockId)) {
        collapsed.push({ blockId: node.blockId, ...(contextLabel ? { label: contextLabel } : {}), recipe: normalizeCollapseRecipe(node.collapse) })
        return null
      }
      return node
    }

    if (node.type === 'nested') {
      // The app boundary; collapsed blocks inside it carry the app's label.
      const innerRoot = walk(node.layout.root, node.label ?? contextLabel)
      if (!innerRoot) return null
      return { ...node, layout: { ...node.layout, root: innerRoot } }
    }

    // split
    const kids = node.children.map(c => walk(c, contextLabel)).filter((c): c is LayoutNode => c !== null)
    if (kids.length === 0) return null
    if (kids.length === 1) return { ...kids[0]!, ...sizeOf(node) }
    return { ...node, children: kids }
  }

  return { visible: walk(root), collapsed }
}

// --- Authoring transforms (pure; the breakpoint author component is the UI) ---

/**
 * Add or update the breakpoint at `minWidth`, shallow-merging `patch` into it
 * (creating it when absent), and keep the list sorted ascending. Immutable —
 * returns a new tree. This is the "author a checkpoint by demonstration" edit:
 * the component computes the collapsed set / variants / arrangement at the
 * current width and writes them here.
 */
export function patchBreakpoint(
  tree: LayoutTree,
  minWidth: number,
  patch: Partial<Omit<LayoutBreakpoint, 'minWidth'>> = {},
): LayoutTree {
  const list = (tree.breakpoints ?? []).slice()
  const idx = list.findIndex(b => b.minWidth === minWidth)
  if (idx >= 0) list[idx] = { ...list[idx]!, ...patch }
  else list.push({ minWidth, ...patch })
  list.sort((a, b) => a.minWidth - b.minWidth)
  return { ...tree, breakpoints: list }
}

/** Remove the breakpoint at `minWidth`; drops the field entirely when none remain. */
export function removeBreakpoint(tree: LayoutTree, minWidth: number): LayoutTree {
  const list = (tree.breakpoints ?? []).filter(b => b.minWidth !== minWidth)
  if (list.length === 0) {
    const { breakpoints: _omit, ...rest } = tree
    return rest
  }
  return { ...tree, breakpoints: list }
}

/** Toggle a `blockId`'s membership in a breakpoint's collapsed set (upserts the bp). */
export function toggleCollapsed(tree: LayoutTree, minWidth: number, blockId: string): LayoutTree {
  const current = (tree.breakpoints ?? []).find(b => b.minWidth === minWidth)?.collapsed ?? []
  const collapsed = current.includes(blockId)
    ? current.filter(id => id !== blockId)
    : [...current, blockId]
  return patchBreakpoint(tree, minWidth, { collapsed })
}

/** Set (or clear, when `variant` is falsy) a block's widget variant at a breakpoint. */
export function setVariant(tree: LayoutTree, minWidth: number, blockId: string, variant: string): LayoutTree {
  const current = { ...((tree.breakpoints ?? []).find(b => b.minWidth === minWidth)?.variants ?? {}) }
  if (variant) current[blockId] = variant
  else delete current[blockId]
  return patchBreakpoint(tree, minWidth, { variants: current })
}

/**
 * Set the collapse motion at a breakpoint (WS6, #875), or clear it (empty / unknown
 * value) so the breakpoint falls back to `DEFAULT_COLLAPSE_STYLE`. Upserts the
 * checkpoint. The chosen style applies to every pane collapsed at that breakpoint.
 */
export function setCollapseStyle(tree: LayoutTree, minWidth: number, style: string): LayoutTree {
  const collapseStyle = isLayoutCollapseStyle(style) ? style : undefined
  return patchBreakpoint(tree, minWidth, { collapseStyle })
}

/** List the blocks placed in a layout root (for the authoring controls). */
export function listBlocks(root: LayoutNode | null, contextLabel?: string): CollapsedPane[] {
  if (!root) return []
  if (root.type === 'leaf') return [{ blockId: root.blockId, ...(contextLabel ? { label: contextLabel } : {}), recipe: normalizeCollapseRecipe(root.collapse) }]
  if (root.type === 'nested') return listBlocks(root.layout.root, root.label ?? contextLabel)
  return root.children.flatMap(c => listBlocks(c, contextLabel))
}
