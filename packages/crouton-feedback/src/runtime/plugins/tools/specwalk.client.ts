import { watch } from 'vue'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { useFeedbackTools } from '../../composables/useFeedbackTools'
import { useSpecWalk } from '../../composables/useSpecWalk'
import { createSpecWalkTool } from '../../tools/specwalk'
import { mountOverlayInBody } from '../../overlay/mount'
import SpecWalkOverlay from '../../components/SpecWalkOverlay.vue'

/**
 * Registers the Spec-walk tool and mounts its panel into the host app's context
 * (so Nuxt UI resolves). The tool hides itself when the app ships no walkable
 * spec, so installing the toolkit costs nothing until an app configures
 * `croutonFeedback.plan`.
 *
 * The #1039 lesson: mount via `mountOverlayInBody` from the plugin — NOT in the
 * page, NOT in app.vue (the POC's page-mount was a workaround for an app.vue
 * that never executed). Body-mounting makes the panel app.vue-independent.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) return
  if (!(import.meta.dev || useRuntimeConfig().public.croutonFeedback)) return

  const { open, walk, badge } = useSpecWalk()
  const registry = useFeedbackTools()

  const tool = createSpecWalkTool({
    count: () => walk.length,
    getBadge: () => badge.value,
    setOpen: (v) => { open.value = v }
  })
  registry.registerTool(tool)

  // Keep the launcher's toggle in sync when the panel is dismissed from its own
  // close button (open → false) rather than via the switch. The row badge
  // (marked/total) is read live by the launcher, so it re-renders as verdicts land.
  watch(open, (v) => { if (!v) registry.deactivate(tool) })

  nuxtApp.hook('app:mounted', () => {
    mountOverlayInBody(SpecWalkOverlay, nuxtApp.vueApp._context, '__feedback_specwalk_root')
  })
})
