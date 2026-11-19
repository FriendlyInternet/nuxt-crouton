// ci-fix-commit.mjs — is this commit the fix-bot's own? (#3104, moved here for #3277)
//
// The fix-bot's commit carries the `CI-Fix: true` trailer and is committed by claude[bot]
// (scripts/commit-ci-fix.sh). Own file, no imports, so the fix-ci workflow can copy it alone into
// $RUNNER_TEMP/lib (owner-merge-go.mjs pulls in approval.mjs and friends). Pure.

export const CI_FIX_MARKER = 'CI-Fix: true'

/** @param {{ commit?: { message?: string, committer?: { name?: string } } } | null | undefined} k a REST commit */
export function isCiFixCommit(k) {
  const msg = k?.commit?.message || ''
  if (!msg.split('\n').some(l => l.trim() === CI_FIX_MARKER)) return false
  return k?.commit?.committer?.name === 'claude[bot]'
}
