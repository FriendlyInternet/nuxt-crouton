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
}
export const BUILDER_SNAP_KEY: InjectionKey<ShallowRef<BuilderSnapPreview | null>> = Symbol('builder-snap')
