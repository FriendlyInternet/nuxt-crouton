/**
 * Open a block's property panel from inside a tiptap NodeView (#1762).
 *
 * Every sales block's editor view repeats the same dance: walk up the DOM to
 * find the owning editor's id, then dispatch a bubbling `block-edit-request`
 * so crouton-pages' BlockPropertyPanel picks it up. This is that dance, once.
 *
 * Deliberately a plain function rather than an auto-imported composable:
 * `VueNodeViewRenderer` mounts NodeViews outside Nuxt's auto-import context, so
 * the views import it explicitly (the same reason they import `computed` and
 * `useI18n` by hand).
 *
 * The older block views still carry their own copies. Converting them is a
 * mechanical follow-up; this exists so new ones stop adding to the pile.
 */
import type { Ref } from 'vue'

/**
 * Walk up to the enclosing `.crouton-editor-blocks` and read its editor id.
 *
 * `closest()` does the walk natively, so this is one query rather than a manual
 * loop with its own null/branch handling.
 */
export function findEditorId(from: HTMLElement | null): string | undefined {
  return from?.closest<HTMLElement>('.crouton-editor-blocks[data-editor-id]')
    ?.dataset.editorId
}

/**
 * Dispatch the panel-open event for one node.
 *
 * `innerRef` is any element inside the NodeView — it is only used as the
 * starting point for the upward walk.
 */
export function useBlockEditRequest(innerRef: Ref<HTMLElement | null>) {
  function openPanel(node: unknown, pos: number) {
    const event = new CustomEvent('block-edit-request', {
      bubbles: true,
      detail: { node, pos, editorId: findEditorId(innerRef.value) }
    })
    document.dispatchEvent(event)
  }

  return { openPanel }
}
