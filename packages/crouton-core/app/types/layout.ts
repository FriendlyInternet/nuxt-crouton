/**
 * Layout tree types — the persisted "layout is data" shape (Sprint 0 spike, #713).
 *
 * A layout is a tree of panes. A `split` node arranges children horizontally or
 * vertically (mapped to a reka-ui SplitterGroup); a `leaf` node hosts one block,
 * resolved id → component through an allowlisted registry map (Sprint 1, #704).
 *
 * Throwaway spike contract — the production tree lands in Sprint 3 (#706) on the
 * new `layout_configs` table.
 */

/**
 * Fixed, curated set of collapse affordances a collapsible pane can pick from
 * (#852). A *closed enum*, NOT free-form per-app CSS — so every collapsed pane
 * is one of a few well-designed, consistent affordances (the same way the block
 * sizing contract is curated). Each style owns its affordance markup in
 * `CroutonLayoutRenderer`; a pane only declares *which* style.
 *
 * - `gutter-tabs` *(first / reference)* — the sales Event-Workspace pattern: a
 *   collapsed pane becomes a vertical tab pinned in a reserved gutter at the
 *   split's edge; the open pane carries a ✕ to re-collapse. Lifted from
 *   `EventWorkspace/Shell.vue`.
 * - `header-toggle` / `icon-rail` — reserved for follow-up styles (the renderer
 *   currently falls back to `gutter-tabs` for them).
 *
 * "Not collapsible" is expressed by `collapsible: false` / omitting it — there is
 * deliberately no `'none'` style.
 */
export type LayoutCollapseStyle = 'gutter-tabs' | 'header-toggle' | 'icon-rail'

export interface LayoutNodeBase {
  /** Default size of this node within its parent split, as a percentage. */
  defaultSize?: number
  /** Minimum size of this node within its parent split, as a percentage. */
  minSize?: number
  /**
   * Whether this pane can collapse into a compact affordance (#852). When false
   * or omitted the pane is never collapsible and `open` is ignored.
   */
  collapsible?: boolean
  /** Which collapse affordance to use when collapsed. Default `'gutter-tabs'`. */
  collapse?: LayoutCollapseStyle
  /**
   * Persisted open/closed state — only meaningful when `collapsible`. Default
   * open (`open` omitted ⇒ treated as `true`); a pane authored default-collapsed
   * sets `open: false`. Lives on the node (keyed by its path in the tree) so it
   * persists alongside sizes via the same `layout_configs` save.
   */
  open?: boolean
}

export interface LayoutLeaf extends LayoutNodeBase {
  type: 'leaf'
  /** Registry id; resolved to a component via the allowlisted blocks map. */
  blockId: string
  /** User-editable props passed to the block (validated against its config schema in Sprint 1). */
  config?: Record<string, unknown>
}

export interface LayoutSplit extends LayoutNodeBase {
  type: 'split'
  direction: 'horizontal' | 'vertical'
  children: LayoutNode[]
}

export type LayoutNode = LayoutLeaf | LayoutSplit

export interface LayoutTree {
  renderer: 'panes'
  root: LayoutNode
}
