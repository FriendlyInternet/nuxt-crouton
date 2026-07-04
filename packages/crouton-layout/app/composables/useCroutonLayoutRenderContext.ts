import type { InjectionKey, Ref } from 'vue'

/**
 * Layout render context (#983, graduation B — `collection-page-render`).
 *
 * The SAME layout tree renders two ways, and a data-bound block (e.g. a
 * collection list) must know which:
 *  - `admin` — a working dashboard surface. A list FILLS its pane and scrolls
 *    internally (the editor / authoring path — `CroutonLayoutRenderer`'s
 *    `interactive=true`). Unchanged behaviour.
 *  - `page`  — a served page or the builder board's live preview. A list is a
 *    CONTENT-SIZED block: a page-size slice + a bounded viewer control
 *    (load-more / paginate / search), NO internal scrollbar, so the page flows
 *    and scrolls as ONE document (`interactive=false`).
 *
 * `CroutonLayoutRenderer` provides this off its own `interactive` flag; a
 * collection block injects it to pick its render. Absent (a block mounted
 * outside the renderer) ⇒ `admin`, so existing standalone use is untouched.
 */
export type LayoutRenderContext = 'admin' | 'page'

export const LAYOUT_RENDER_CONTEXT_KEY: InjectionKey<Ref<LayoutRenderContext>>
  = Symbol('crouton-layout-render-context')
