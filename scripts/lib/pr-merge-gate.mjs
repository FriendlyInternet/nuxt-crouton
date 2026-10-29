// Review gate for a PR the automerge workflow is about to merge (#3103) — the ONE place that says
// whether the review/owner-go requirement is met. Red checks, CI Gate and conflict state are the
// workflow's own earlier gates; this covers only "who has to have said yes".
//
//   work-* → main  : the owner's `ok` IS the review (the reviewer only labels epic-based PRs, so a
//                    `build:approved` requirement could never be met and `ok` merged nothing)
//   epic/* → main  : `build:approved` AND the owner's `ok`
//   work-* → epic/*: `build:approved`
//
// Pure: `go` is the already-computed result of ownerMergeGo().
export function decideReviewGate({ baseRef, headRef, labels = [], go }) {
  const leafToMain = baseRef === 'main' && String(headRef).startsWith('work-')
  const epicToMain = baseRef === 'main' && String(headRef).startsWith('epic/')
  if (!leafToMain && !labels.includes('build:approved')) return { merge: false, reason: "no 'build:approved' yet" }
  if ((leafToMain || epicToMain) && !go?.go) return { merge: false, reason: "waits for the owner's ok" }
  return { merge: true, reason: leafToMain ? 'owner ok' : 'reviewed' }
}
