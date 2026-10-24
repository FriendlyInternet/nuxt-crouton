import { computed, ref } from 'vue'
import { useRuntimeConfig } from 'nuxt/app'
import type { ComposedPlan } from '../tools/plan-data'

/**
 * The client-side view of the Plan tool, read from
 * `runtimeConfig.public.croutonPlan` (composed by the module at build from the
 * app's plan overlay JSON + spec ledger). Exposes the composed plan the overlay
 * renders natively with Nuxt UI, the launcher badge, and a shared open flag.
 *
 * Data-first (like useChangelog): the module ships the joined structure, so the
 * overlay is plain Nuxt UI over a stable shape — no iframe, no bespoke renderer.
 */
export type PlanPublicConfig = Partial<ComposedPlan>

// Module-singleton so the tool factory (opens it) and the overlay (renders it)
// share one reactive flag — the same pattern useChangelog uses.
const open = ref(false)

export function usePlan() {
  const cfg = (useRuntimeConfig().public.croutonPlan ?? {}) as PlanPublicConfig

  const plan = computed<PlanPublicConfig>(() => cfg)
  const badge = computed<string | null>(() => cfg.badge || null)
  const hasPlan = computed<boolean>(() => Array.isArray(cfg.phases) && cfg.phases.length > 0)

  return { plan, badge, hasPlan, open }
}
