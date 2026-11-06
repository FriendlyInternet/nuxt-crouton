import { decideSharedCodeHold } from '../shared-code-hold.mjs'
// The leaf merge rules for a PR the automerge workflow is about to merge (#3103) live in THIS FILE, not in one
// function (#3491, owner 6 Nov 18:38): skipBeforeReads() runs before any reads (draft, base shape, pipeline
// author); decideLeafMerge() decides who said yes, any red check, CI Gate, mergeable; applySharedCodeHold()
// adds the packages/ + workflows hold; shadowCheck() shapes the answer for #3492's check-run. The workflow
// gathers the facts and acts on the answers; nothing calls the #3491 functions yet (#3492 wires them).
//
//   (#3467) A merge commit after the owner's `ok` keeps the ok but may have resolved conflicts, so the PR
//   also waits for a build-review `go` on the CURRENT head (`headReview.kind === 'other'`); on an epic base
//   `build:approved` only counts when the head itself was reviewed `go` (the label outlives a new push).
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

const mainDecision = ({ go, ownerHold, short, headReview, reviewedGo, ok }) => {
  if (!go?.go) return hold('no-ok', "waits for the owner's ok")
  if (go.mergeSince && !reviewedGo && !okAfter(go, ownerHold)) {
    return hold('head-unreviewed', `a base merge landed after the owner's ok — waits for the build review of ${short} (now: ${headReview?.kind})`)
  }
  return ok('owner ok')
}

const epicDecision = ({ labels, go, ownerHold, short, reviewedGo, ok }) => {
  const approved = labels.includes('build:approved')
  const afterHold = okAfter(go, ownerHold)
  if (approved && !reviewedGo && !afterHold) {
    return hold('head-unreviewed', `build:approved is for an older commit — waits for the build review of ${short}`)
  }
  if (approved) return ok('reviewed')
  if (afterHold) return ok(ownerHold.kind === 'needs-owner' ? 'owner ok after needs-owner' : 'owner ok after final hold')
  return hold('no-review', "no 'build:approved' yet")
}

export function decideLeafMerge({ baseRef, headRef, labels = [], go, ownerHold = null, headSha = '', headReview = { kind: 'pending' }, red = false, firstRun = [], ciGate, mergeableState }) {
  const blocked = preflight({ baseRef, head: String(headRef), red, ciGate, mergeableState })
  if (blocked) return blocked
  const names = firstRun.join(', ')
  if (firstRun.length && !go?.go) return hold('first-run-no-ok', `first-run check ${names} waits for the owner's ok`)
  const ok = (r) => ({ merge: true, code: 'merge', reason: firstRun.length ? `${r}; first-run check ${names} ignored after owner ok` : r, ...(firstRun.length ? { firstRun } : {}) })
  const ctx = { labels, go, ownerHold, headReview, ok, reviewedGo: headReview?.kind === 'other', short: String(headSha || '').slice(0, 8) }
  return baseRef === 'main' ? mainDecision(ctx) : epicDecision(ctx)
}

// #3491: the pre-read skips of automerge-epic-subpr.yml L248-254, in the same order.
export function skipBeforeReads({ draft, authorIsPipeline, baseRef, headRef }) {
  const base = String(baseRef), head = String(headRef)
  if (draft) return { skip: true, code: 'draft' }
  const epicToMain = base === 'main' && head.startsWith('epic/')
  const leafToMain = base === 'main' && head.startsWith('work-')
  if (!base.startsWith('epic/') && !epicToMain && !leafToMain) return { skip: true, code: 'not-epic-base' }
  if (authorIsPipeline !== true) return { skip: true, code: 'not-pipeline' }
  return { skip: false }
}

// #3491: the shared-code hold of L359-369. It only ever turns a `merge` into a hold.
export function applySharedCodeHold(gate, { baseRef, labels = [], files = [], go }) {
  if (!gate?.merge) return gate
  const s = decideSharedCodeHold({ baseRef, labels, files })
  if (s.action === 'hold' && !go?.go) return { ...hold('shared-code', s.reason), held: s.held, hasPkgs: s.hasPkgs, hasWf: s.hasWf }
  return gate
}

// #3491: the payload for #3492's information-only check-run.
export function shadowCheck(answer) {
  const merge = answer?.merge === true
  const code = merge ? 'merge' : String(answer?.code || 'unknown')
  return { name: 'Merge decision (shadow)', conclusion: merge ? 'success' : 'neutral',
    output: { title: code, summary: merge ? `would merge — ${answer.reason || code}` : `would hold: ${code}${answer?.reason ? ` — ${answer.reason}` : ''}` } }
}
