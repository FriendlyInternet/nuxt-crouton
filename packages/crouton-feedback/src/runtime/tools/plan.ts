import type { FeedbackTool } from '../composables/useFeedbackTools'

/**
 * Context the Plan tool needs from the host — kept injectable so the factory is
 * a pure, unit-testable description of the menu row (no Vue/Nuxt imports). The
 * client plugin wires these to `usePlan`.
 */
export interface PlanToolContext {
  /** Whether a plan document is configured (hides the tool when false). */
  hasPlan: () => boolean
  /** The launcher-row badge — the active phase/increment id, or null. */
  getBadge: () => string | null
  /** Open/close the plan overlay. */
  setOpen: (open: boolean) => void
}

/**
 * The **Plan** tool — a badged row in the glasses launcher that opens a plan
 * document (a self-contained HTML page shown in an iframe). Like Changelog it
 * drives a transient modal, so activate/deactivate just flip its open flag, and
 * it hides itself when the app ships no plan.
 */
export function createPlanTool(ctx: PlanToolContext): FeedbackTool {
  return {
    id: 'plan',
    label: 'Plan',
    icon: 'i-lucide-map',
    order: 6,
    isAvailable: () => ctx.hasPlan(),
    badge: () => ctx.getBadge(),
    activate: () => ctx.setOpen(true),
    deactivate: () => ctx.setOpen(false)
  }
}
