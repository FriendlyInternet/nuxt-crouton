import type { FeedbackTool } from '../composables/useFeedbackTools'

/**
 * Context the Spec-walk tool needs from the host — kept injectable so the
 * factory is a pure, unit-testable description of the launcher row (no Vue/Nuxt
 * imports). The client plugin wires these to `useSpecWalk`.
 */
export interface SpecWalkToolContext {
  /** Whether the app has any LIVE behaviours to walk (hides the tool when 0). */
  count: () => number
  /** The launcher-row badge — `marked/total`, or null when nothing to walk. */
  getBadge: () => string | null
  /** Open/close the walk panel. */
  setOpen: (open: boolean) => void
}

/**
 * The **Spec walk** tool — the "does it still work?" facet of the glasses
 * launcher (#1038). It walks the app's LIVE behaviours (from the same composed
 * plan the Plan tool ships) one at a time against the running build, capturing
 * ✅/⚠️ verdicts and exporting the `lgtm <id>` C1 sign-off. Like Plan it drives a
 * transient panel, so activate/deactivate just flip its open flag, and it hides
 * itself when the app ships no walkable spec.
 */
export function createSpecWalkTool(ctx: SpecWalkToolContext): FeedbackTool {
  return {
    id: 'specwalk',
    label: 'Spec walk',
    icon: 'i-lucide-list-checks',
    order: 5,
    isAvailable: () => ctx.count() > 0,
    badge: () => ctx.getBadge(),
    activate: () => ctx.setOpen(true),
    deactivate: () => ctx.setOpen(false)
  }
}
