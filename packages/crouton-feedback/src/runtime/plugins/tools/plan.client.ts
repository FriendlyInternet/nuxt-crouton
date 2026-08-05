import { watch } from 'vue'
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app'
import { useFeedbackTools } from '../../composables/useFeedbackTools'
import { usePlan } from '../../composables/usePlan'
import { createPlanTool } from '../../tools/plan'
import { mountOverlayInBody } from '../../overlay/mount'
import PlanOverlay from '../../components/PlanOverlay.vue'

/**
 * Registers the Plan tool and mounts its overlay into the host app's context
 * (so Nuxt UI resolves). The tool hides itself when the app ships no plan, so
 * installing the toolkit costs nothing until an app configures
 * `croutonFeedback.plan`.
 */
export default defineNuxtPlugin((nuxtApp) => {
  if (!import.meta.client) return
  if (!(import.meta.dev || useRuntimeConfig().public.croutonFeedback)) return

  const { hasPlan, badge, open } = usePlan()
  const registry = useFeedbackTools()

  const tool = createPlanTool({
    hasPlan: () => hasPlan.value,
    getBadge: () => badge.value,
    setOpen: (v) => { open.value = v }
  })
  registry.registerTool(tool)

  // Keep the launcher's toggle in sync when the modal is dismissed from its own
  // close button (open → false) rather than via the switch.
  watch(open, (v) => { if (!v) registry.deactivate(tool) })

  nuxtApp.hook('app:mounted', () => {
    mountOverlayInBody(PlanOverlay, nuxtApp.vueApp._context, '__feedback_plan_root')
  })
})
