import type { InjectionKey, Ref, ShallowRef } from 'vue'
import type { LayoutNode } from '@fyit/crouton-core/app/types/layout'
import type { PaneDropEdge } from '@fyit/crouton-layout/app/utils/layout-edit'

/**
 * Builder injection keys — the provide/inject contract between the board page and
 * the block/node chrome. Kept in one place (auto-imported from `~/utils`).
 */

/** The label of the item a ghost pane stands in for (threaded to BuilderGhostPane). */
export const BUILDER_GHOST_LABEL_KEY: InjectionKey<Ref<string | null> | null> = Symbol('builder-ghost-label')

/** A node pinned to a page edge as a sticky region (bounded enum; undefined = main flow). */
export type BuilderRegion = 'top' | 'bottom'

/**
 * Pin a node to a page region (spec: `page-regions-pin`) — the bounded-vocabulary expressiveness
 * feature. A node can be pinned to the page's top or bottom edge (a sticky bar) from its toolbar;
 * `null` clears it back to the main flow. A bounded ENUM an agent could equally pick, kept on the
 * FlowNode data. The board provides this; BuilderBlockNode calls it (node by object identity of its
 * `data.node`, like the snap callbacks — Vue Flow doesn't forward the node id).
 */
export const BUILDER_SET_REGION_KEY: InjectionKey<(node: LayoutNode, region: BuilderRegion | null) => void> = Symbol('builder-set-region')

/**
 * Per-element resize (spec: `per-element-resize`) — each card carries its own display width/height;
 * dragging its corner handle sets them (the handle IS the per-element size control, replacing any
 * board-wide slider). `width: null` clears back to the intrinsic footprint size. The board provides
 * this; BuilderBlockNode calls it (node by object identity of its `data.node`).
 */
export interface BuilderNodeSize { width: number | null, height?: number | null }
export const BUILDER_SET_SIZE_KEY: InjectionKey<(node: LayoutNode, size: BuilderNodeSize) => void> = Symbol('builder-set-size')

/**
 * Detach / reorder (spec: `detach-reorder`) — the inverse of snap, ON the board. Long-press a
 * composed card → its top-level panes wiggle (grabbable). Sliding a pane to another slot REORDERS
 * (moveChild); pulling it OUT past the detach margin DETACHES it into its own free card (detachNode).
 * The board owns `nodes`, so it provides these; BuilderBlockNode calls them (group by object
 * identity of its `data.node`). `dropOffset` is the pulled pane's flow-space offset from the group's
 * top-left, so the freed card lands where you dropped it. Scope: top-level panes only.
 */
export interface BuilderDetachPayload { index: number, dropOffset: { x: number, y: number } }
export const BUILDER_DETACH_KEY: InjectionKey<(group: LayoutNode, payload: BuilderDetachPayload) => void> = Symbol('builder-detach')
export interface BuilderReorderPayload { from: number, to: number }
export const BUILDER_REORDER_KEY: InjectionKey<(group: LayoutNode, payload: BuilderReorderPayload) => void> = Symbol('builder-reorder')

/**
 * Live snap preview (spec: `snap-dwell-arm`) — set continuously by the board WHILE a card is
 * dragged. It names the TARGET node the dragged card will click onto and the edge it snaps to,
 * so that target's card can light that edge up. `armed` is the two-stage dwell: `false` = soft
 * (just approached, blue), `true` = held long enough that releasing WILL snap (green). The target
 * is matched in the node component by OBJECT IDENTITY of its `data.node` (Vue Flow doesn't forward
 * the node id to a default node component); the board tracks `targetId` separately for the
 * on-release merge. A `shallowRef` — the value is a small immutable record swapped each frame.
 */
export interface BuilderSnapPreview {
  targetId: string
  targetNode: LayoutNode
  edge: PaneDropEdge
  armed: boolean
  /**
   * When set, this is a DROP-BESIDE-PANE (spec: `pane-drop-beside`) — the dragged card is OVER a
   * composed target and will land beside the pane at `path` on `edge`, not merge onto the card's
   * outer edge. `rect` is that pane's box as a 0..1 fraction of the target card, so the guide band
   * can draw on the right edge of the specific pane.
   */
  paneDrop?: { path: number[], edge: PaneDropEdge, rect: { left: number, top: number, width: number, height: number } }
}
export const BUILDER_SNAP_KEY: InjectionKey<ShallowRef<BuilderSnapPreview | null>> = Symbol('builder-snap')
