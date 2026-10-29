// Merge decision for a `work-*` → `main` PR (#3103).
//
// The `build:approved` label is only ever added to PRs based on an `epic/*` branch, so a leaf PR
// straight to main could never satisfy that gate and the owner's `ok` merged nothing. For this
// shape the owner's `ok` IS the review: merge when it is the last word and the required checks are
// green. Epic-based PRs keep needing `build:approved`.
//
// Pure: `go` is the already-computed result of ownerMergeGo().
export function decideLeafMerge({ baseRef, headRef, labels = [], go, red, ciGate, mergeableState }) {
  const isLeafToMain = baseRef === 'main' && String(headRef).startsWith('work-')
  if (isLeafToMain) {
    if (!go?.go) return { merge: false, reason: "waits for the owner's ok" }
  } else if (String(baseRef).startsWith('epic/')) {
    if (!labels.includes('build:approved')) return { merge: false, reason: "no 'build:approved' yet" }
    if (!go?.go) return { merge: true, reason: 'epic-based PR, reviewed' }
  } else {
    return { merge: false, reason: 'not a leaf → main or epic-based PR' }
  }
  if (['dirty', 'blocked'].includes(mergeableState)) return { merge: false, reason: `state is ${mergeableState}` }
  if (red) return { merge: false, reason: 'a check is failing' }
  if (ciGate !== 'success') return { merge: false, reason: `CI Gate is ${ciGate}` }
  return { merge: true, reason: isLeafToMain ? 'owner ok + checks green' : 'reviewed + checks green' }
}
