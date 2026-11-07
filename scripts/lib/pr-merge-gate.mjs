import { decideSharedCodeHold } from '../shared-code-hold.mjs'
import { isV1Base } from './pipeline-version.mjs'
// The leaf merge rules for a PR the automerge workflow is about to merge (#3103) live in THIS FILE (#3491, #3461):
//   decideReview()         who said yes (owner ok / build:approved on the reviewed head) — review only, no CI facts.
//   decideLeafMerge()      preflight (red check, CI Gate, mergeable) + first-run rule + decideReview(); what today's workflow uses.
//   decideV1()             the v1 answer for a PR into a v1 epic branch: review only, GitHub does the CI wait (#3501).
//   mergeDecisionCheck()   the check-run payload for an answer (pass = success, wait = in_progress, never neutral).
//   skipBeforeReads() / applySharedCodeHold()  the pre-read skips and the packages/ + workflows hold.
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

export function decideReview({ baseRef, headRef, labels = [], go, ownerHold = null, headSha = '', headReview = { kind: 'pending' } }) {
  const ok = (r) => ({ merge: true, code: 'merge', reason: r })
  const ctx = { labels, go, ownerHold, headReview, ok, reviewedGo: headReview?.kind === 'other', short: String(headSha || '').slice(0, 8) }
  return baseRef === 'main' ? mainDecision(ctx) : epicDecision(ctx)
}

export function decideLeafMerge({ baseRef, headRef, labels = [], go, ownerHold = null, headSha = '', headReview = { kind: 'pending' }, red = false, firstRun = [], ciGate, mergeableState }) {
  const blocked = preflight({ baseRef, head: String(headRef), red, ciGate, mergeableState })
  if (blocked) return blocked
  const names = firstRun.join(', ')
  if (firstRun.length && !go?.go) return hold('first-run-no-ok', `first-run check ${names} waits for the owner's ok`)
  const r = decideReview({ baseRef, headRef, labels, go, ownerHold, headSha, headReview })
  if (r.merge && firstRun.length) return { ...r, reason: `${r.reason}; first-run check ${names} ignored after owner ok`, firstRun }
  return r
}

// #3461: the v1 answer. No red/ciGate/mergeableState: a required check built on this would otherwise wait on itself.
export function decideV1({ draft, authorIsPipeline, baseRef, headRef, labels = [], go, ownerHold = null, headSha = '', headReview = { kind: 'pending' }, files, red = false } = {}) {
  if (!isV1Base(baseRef)) return hold('not-v1-base', `base ${baseRef} is not a v1 epic branch`)
  const s = skipBeforeReads({ draft, authorIsPipeline, baseRef, headRef })
  if (s.code === 'draft') return hold('draft', 'draft sign-off PR — waits until the owner marks it ready')
  // C2 (#339): a failing check holds the answer — `red` comes from isRed() over the runs minus `Merge decision`
  if (red) return hold('red', 'has a failing check')
  if (s.code === 'not-pipeline') return { merge: true, code: 'not-pipeline', autoMerge: false, reason: 'not a pipeline PR — merged by hand' }
  if (s.skip) return hold(s.code, `skipped: ${s.code}`)
  const r = decideReview({ baseRef, headRef, labels, go, ownerHold, headSha, headReview })
  if (r.merge && !Array.isArray(files)) return { ...hold('need-files', 'needs the PR file list for the shared-code hold'), needFiles: true }
  return applySharedCodeHold(r, { baseRef, labels, files, go })
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

// #3461: the payload for the required `Merge decision` check-run. A wait is in_progress, never neutral/skipped.
export const MERGE_DECISION = 'Merge decision'

// the check's own run must never count toward `red` (it would wait on itself)
export const withoutMergeDecision = (runs = []) => runs.filter((r) => r.name !== MERGE_DECISION)

// turn auto-merge on for any pipeline answer (merge or hold); owner PRs are merged by hand
export const shouldEnableAuto = ({ answer, autoMergeOn }) => answer?.code !== 'not-pipeline' && !autoMergeOn

// The App bypasses the ruleset, so its own pulls.merge would succeed past a pending check: check it here, never rely on GitHub refusing.
export const canMergeNow = ({ answer, ciGate, red }) =>
  answer?.merge === true && answer.code !== 'not-pipeline' && ciGate === 'success' && !red

export function mergeDecisionCheck(answer) {
  if (answer?.merge === true) {
    return { name: MERGE_DECISION, status: 'completed', conclusion: 'success', output: { title: 'approved', summary: String(answer.reason || answer.code || 'approved') } }
  }
  const code = String(answer?.code || 'unknown')
  return { name: MERGE_DECISION, status: 'in_progress', output: { title: `waiting: ${code}`, summary: String(answer?.reason || code) } }
}
