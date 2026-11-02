// One definition of "this pipeline run produced something" (#3219).
// Used by the artifact gate in .github/workflows/work-issue-pidev.yml. First match wins;
// `via` names the signal so the comment can say what was found.
export function decideDeliverable({
  linkedPR = false,
  workBranchPushed = false,
  signoffHeld = false,
  alreadyClosed = false,
  createdSubIssues = false,
  childDeliverable = '',
} = {}) {
  if (linkedPR) return { ok: true, via: 'linked-pr' }
  // A commit pushed to work-<N> this run is a deliverable even when the PR already existed
  // (a cross-reference older than t0 is deliberately ignored — #1019).
  if (workBranchPushed) return { ok: true, via: 'work-branch' }
  if (signoffHeld) return { ok: true, via: 'signoff-held' }
  if (alreadyClosed) return { ok: true, via: 'already-closed' }
  if (createdSubIssues) return { ok: true, via: 'sub-issues' }
  if (childDeliverable) return { ok: true, via: 'child' }
  return { ok: false, via: null }
}
