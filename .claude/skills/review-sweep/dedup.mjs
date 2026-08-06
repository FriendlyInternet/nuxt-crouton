/**
 * Dedup logic for the review-sweep gather script (#2101) — decides which findings from a
 * fresh package-wide sweep are genuinely NEW versus already tracked, so re-running the sweep
 * edits one backlog issue in place instead of piling up duplicates.
 *
 * NOT YET IMPLEMENTED — this is the Test Sign-Off gate (#774) artifact: the failing test
 * (dedup.test.mjs) is proposed first, held for owner sign-off on issue #2101, and only
 * implemented after `lgtm`/`approve`.
 *
 * Intended contract (see dedup.test.mjs for the concrete cases):
 *   dedupFindings(newFindings, existingItems) => { kept: Finding[], dropped: Finding[] }
 *   - Finding shape: { file: string, description: string, severity?: string }
 *   - A new finding is DROPPED when an existing item matches it by (file, description).
 *   - A new finding is KEPT when nothing prior matches it.
 *   - Re-running with an identical finding set against its own prior output nets zero KEPT.
 */

export function dedupFindings(_newFindings, _existingItems) {
  throw new Error(
    'dedupFindings: not implemented — pending Test Sign-Off on https://github.com/FriendlyInternet/nuxt-crouton/issues/2101'
  )
}
