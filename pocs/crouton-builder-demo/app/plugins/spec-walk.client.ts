import { watch } from 'vue'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { useSpecWalk } from '../composables/useSpecWalk'

/**
 * Registers the "Spec walk" tool in the crouton-feedback glasses launcher (#1039) —
 * the same registry the Console/Annotate/Changelog tools use. Activating it opens the
 * shared bottom-sheet panel (SpecWalkPanel, mounted in app.vue) via the `open` flag in
 * useSpecWalk. Mirrors crouton-feedback's changelog.client.ts.
 *
 * NB: the API is `useFeedbackTools()` (crouton-feedback) — NOT the old
 * `useCroutonDevTools()`, which was renamed in #960 and is why earlier attempts to
 * register never surfaced in the launcher. Gated on the same `croutonFeedback` flag the
 * launcher itself uses, so it registers exactly when the pill is present.
 */

interface FeedbackTool {
  id: string; label: string; icon: string; order?: number
  isAvailable?: () => boolean; activate?: () => void | Promise<void>
  deactivate?: () => void; badge?: () => string | number | null
}
interface FeedbackToolsRegistry {
  registerTool: (t: FeedbackTool) => void
  deactivate: (t: FeedbackTool) => void
}
// Auto-imported by @fyit/crouton-feedback; declared so this file also compiles under a
// plain prepare/typecheck. Reached only inside the client + flag guard, wrapped in try/catch.
declare function useFeedbackTools(): FeedbackToolsRegistry

export default defineNuxtPlugin(() => {
  if (!import.meta.client) return
  if (!(import.meta.dev || useRuntimeConfig().public.croutonFeedback)) return

  let registry: FeedbackToolsRegistry | null = null
  try { const r = useFeedbackTools(); registry = r && typeof r.registerTool === 'function' ? r : null } catch { registry = null }
  if (!registry) return

  const { open, marked, walk } = useSpecWalk()

  const tool: FeedbackTool = {
    id: 'spec-walk',
    label: 'Spec walk',
    icon: 'i-lucide-footprints',
    order: 7,
    badge: () => (walk.length ? `${marked.value}/${walk.length}` : null),
    activate: () => { open.value = true },
    deactivate: () => { open.value = false }
  }
  registry.registerTool(tool)

  // Keep the launcher's toggle in sync when the panel is closed from its own X.
  watch(open, (v) => { if (!v) registry!.deactivate(tool) })
})
