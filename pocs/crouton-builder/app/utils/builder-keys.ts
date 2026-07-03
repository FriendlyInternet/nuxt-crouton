import type { InjectionKey, Ref } from 'vue'

/**
 * Builder injection keys — the provide/inject contract between the board page and
 * the block/node chrome. Kept in one place (auto-imported from `~/utils`).
 */

/** The label of the item a ghost pane stands in for (threaded to BuilderGhostPane). */
export const BUILDER_GHOST_LABEL_KEY: InjectionKey<Ref<string | null> | null> = Symbol('builder-ghost-label')

/** A node pinned to a page edge as a sticky region (bounded enum; undefined = main flow). */
export type BuilderRegion = 'top' | 'bottom'
