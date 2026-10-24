/**
 * Is this head branch one the agent pipeline authored? (#2089)
 *
 * ONE definition, because the two-copy version already cost us. `pipeline-pr-status.yml`
 * learned about the pi worker's `work-<n>` branches in #1815; `fix-ci-on-failure.yml` did
 * not — and since `AGENT_HARNESS=pi` made that the live lane, its guard
 * (`startsWith(head_branch, 'claude/issue-')`) could no longer be true for any PR. The
 * fix-bot ran 1718 times and skipped every one; over the last 60 PRs, 32 were `work-*` and
 * zero were `claude/issue-*`.
 *
 * The failure mode is why it survived: a workflow whose job `if` is false reports `skipped`,
 * which is indistinguishable from "there was nothing to do". Nothing was ever red.
 *
 * WHAT MUST NOT DRIFT: human branches (`fix/*`, `feat/*`, anything else) are NOT pipeline
 * branches. Every consumer of this predicate uses it to decide whether an agent may push to
 * someone's PR, so widening it is not a convenience — it is a change in who is allowed to
 * edit your work.
 */

/** Prefixes the pipeline opens PRs from. `claude/issue-` = the claude lane, `work-` = pi. */
export const PIPELINE_BRANCH_PREFIXES = ['claude/issue-', 'work-']

export function isPipelineBranch(ref) {
  const s = String(ref || '')
  return PIPELINE_BRANCH_PREFIXES.some((p) => s.startsWith(p))
}
