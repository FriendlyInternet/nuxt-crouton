import type { CroutonDevTool } from '../composables/useCroutonDevTools'
import { useCroutonAnnotate } from '../composables/useCroutonAnnotate'

/**
 * The **Annotate** dev-tool (#810) — pin a comment on a page element; it builds
 * the structured `ReviewAnnotation` (route + selector + the owning source file
 * from #490's `data-crouton-src`) and POSTs it to `/api/_review`. The launcher
 * toggle drives select-mode (no separate FAB anymore); the CroutonAnnotate
 * overlay renders the highlight + comment panel.
 */
export function createAnnotateTool(): CroutonDevTool {
  const { start, stop } = useCroutonAnnotate()

  return {
    id: 'annotate',
    label: 'Annotate',
    icon: 'i-lucide-pen-line',
    order: 2,
    activate: () => start(),
    deactivate: () => stop()
  }
}
