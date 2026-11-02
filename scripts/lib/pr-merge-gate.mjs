// The merge decision for a PR the automerge workflow is about to merge (#3103) — the ONE place that
// owns the whole rule: who said yes, any red check, CI Gate, mergeable. The workflow gathers the
// facts (checks, comments, commits) and acts on the answer; it holds no merge rule of its own.
//
//   work-* → main  : the owner's `ok` IS the review (the reviewer only labels epic-based PRs, so a
//                    `build:approved` requirement could never be met and `ok` merged nothing)
//   epic/* → main  : `build:approved` AND the owner's `ok`
//   work-* → epic/*: `build:approved`
//
// Pure. `go` is the already-computed result of ownerMergeGo(); `ciGate` is the required check's
// state ('success' | 'pending' | 'missing' | …); `red` is true when any check has failed.
// `code` lets the caller react to a specific hold (e.g. warn once when the CI Gate never reported).
export function decideLeafMerge({ baseRef, headRef, labels = [], go, red = false, ciGate, mergeableState }) {
  const head = String(headRef)
  const leafToMain = baseRef === 'main' && head.startsWith('work-')
  const epicToMain = baseRef === 'main' && head.startsWith('epic/')
  const epicBased = String(baseRef).startsWith('epic/')
  if (!leafToMain && !epicToMain && !epicBased) return { merge: false, code: 'ineligible', reason: `base ${baseRef} / head ${head} is not an auto-merge shape` }
  if (['dirty', 'blocked'].includes(mergeableState)) return { merge: false, code: 'unmergeable', reason: `not auto-mergeable (state=${mergeableState})` }
  if (red) return { merge: false, code: 'red', reason: 'has a failing check' }
  if (ciGate !== 'success') return { merge: false, code: `ci-${ciGate}`, reason: `CI Gate is ${ciGate}` }
  if (!leafToMain && !labels.includes('build:approved')) return { merge: false, code: 'no-review', reason: "no 'build:approved' yet" }
  if ((leafToMain || epicToMain) && !go?.go) return { merge: false, code: 'no-ok', reason: "waits for the owner's ok" }
  return { merge: true, code: 'merge', reason: leafToMain ? 'owner ok' : 'reviewed' }
}
