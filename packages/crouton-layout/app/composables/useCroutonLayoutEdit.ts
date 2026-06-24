import type { InjectionKey, Ref } from 'vue'
import type { NodePath, DropEdge } from '../utils/layout-edit'

/**
 * The edit API the editable `CroutonLayout` provides to every recursive
 * `CroutonLayoutEditorPane` (Sprint 3, #706). Panes are addressed by a
 * `NodePath` and call these directly (provide/inject) instead of bubbling a
 * stack of events through the recursion.
 */
export interface LayoutEditApi {
  /** True while a block is being dragged from the palette (reveals drop zones). */
  dragging: Ref<boolean>
  /** The currently selected leaf path (serialized `a.b.c`), or null. */
  selectedPath: Ref<string | null>
  /** Drop a block onto the pane at `path` along `edge` (splits / swaps / seeds). */
  drop: (path: NodePath, blockId: string, edge: DropEdge) => void
  /** Remove the pane at `path` (collapses its parent split). */
  remove: (path: NodePath) => void
  /** Persist reka-ui resize results for the split at `path`. */
  resize: (path: NodePath, sizes: number[]) => void
  /** Select the leaf at `path` (opens its config panel). */
  select: (path: NodePath) => void
}

export const LAYOUT_EDIT_KEY: InjectionKey<LayoutEditApi> = Symbol('crouton-layout-edit')

/** Serialize/parse a NodePath as the `selectedPath` string key. */
export const pathKey = (path: NodePath): string => path.join('.')
export const parsePathKey = (key: string): NodePath =>
  key === '' ? [] : key.split('.').map(Number)
