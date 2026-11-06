// The merge decision for a PR the automerge workflow is about to merge (#3103) — the ONE place that
// owns the whole rule: who said yes, any red check, CI Gate, mergeable. The workflow gathers the
// facts (checks, comments, commits) and acts on the answer; it holds no merge rule of its own.
//
//   work-* → main  : the owner's `ok` IS the review (the reviewer only labels epic-based PRs, so a
//                    `build:approved` requirement could never be met and `ok` merged nothing)
//   epic/* → main  : not decided here — scripts/epic-merge-decision.mjs owns it (#3105)
//   work-* → epic/*: `build:approved`, OR the owner's `ok` given AFTER the reviewer's final "rejected
//                    twice" hold on this commit (#3173) — `ownerHold` is {kind, at} from reviewState() when kind is final or needs-owner (#3428), else null
//
// Pure. `go` is the already-computed result of ownerMergeGo(); `ciGate` is the required check's
// state ('success' | 'pending' | 'missing' | …); `red` is true when any check has failed.
// `firstRun` (#3470) names red checks that fail only because the PR adds the code they load; they are
// ignored, but ONLY with the owner's ok (never without it, even for a `build:approved` PR).
// `code` lets the caller react to a specific hold (e.g. warn once when the CI Gate never reported).
const hold = (code, reason) => ({ merge: false, code, reason })

const okAfter = (go, ownerHold) =>
  Boolean(ownerHold?.at && go?.go && go.approvedAt && new Date(go.approvedAt) > new Date(ownerHold.at))

const preflight = ({ baseRef, head, red, ciGate, mergeableState }) => {
  const leafToMain = baseRef === 'main' && head.startsWith('work-')
  if (!leafToMain && !String(baseRef).startsWith('epic/')) return hold('ineligible', `base ${baseRef} / head ${head} is not an auto-merge shape`)
  if (['dirty', 'blocked'].includes(mergeableState)) return hold('unmergeable', `not auto-mergeable (state=${mergeableState})`)
  if (red) return hold('red', 'has a failing check')
  if (ciGate !== 'success') return hold(`ci-${ciGate}`, `CI Gate is ${ciGate}`)
  return null
}

export function decideLeafMerge({ baseRef, headRef, labels = [], go, ownerHold = null, red = false, firstRun = [], ciGate, mergeableState }) {
  const head = String(headRef)
  const blocked = preflight({ baseRef, head, red, ciGate, mergeableState })
  if (blocked) return blocked
  const names = firstRun.join(', ')
  if (firstRun.length && !go?.go) return hold('first-run-no-ok', `first-run check ${names} waits for the owner's ok`)
  const done = (r) => ({ merge: true, code: 'merge', reason: firstRun.length ? `${r}; first-run check ${names} ignored after owner ok` : r, ...(firstRun.length ? { firstRun } : {}) })
  if (baseRef === 'main') {
    return go?.go ? done('owner ok') : hold('no-ok', "waits for the owner's ok")
  }
  const approved = labels.includes('build:approved')
  if (approved) return done('reviewed')
  if (okAfter(go, ownerHold)) return done(ownerHold.kind === 'needs-owner' ? 'owner ok after needs-owner' : 'owner ok after final hold')
  return hold('no-review', "no 'build:approved' yet")
}
