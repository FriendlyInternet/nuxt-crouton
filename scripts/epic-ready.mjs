#!/usr/bin/env node
// epic-ready.mjs — the pure "is this epic assembled and ready to PR into main?" decision (#1815).
//
// WHY a pure module. The GitHub I/O (list sub-issues, list PRs, compare branches) lives in
// .github/workflows/epic-ready-pr.yml; this file is the deterministic predicate it calls, so the
// rule is unit-tested in isolation (mirrors apply-decompose-plan.mjs's pure-core / thin-executor
// split). The workflow fires on `issues: closed` — by then schedule-waves.yml has already closed
// the child whose sub-PR merged (a non-default-branch merge does NOT auto-close its `Closes #NN`,
// so schedule-waves closes it explicitly), which is why "all sub-issues closed" is the correct
// completeness signal and racing `pull_request: closed` is not.

/** epic/<n>-<slug> → n (number), else null. */
export function parseEpicNumber(ref) {
  const m = /^epic\/(\d+)-/.exec(ref || '')
  return m ? Number(m[1]) : null
}

/**
 * Resolve which issue number to treat as "the epic" for a just-closed pipeline issue, and
 * whether it's a genuine multi-child epic or a SOLO LEAF using itself as its own integration
 * branch (#1686's single-use worker: `EPIC="${EPIC:-$ISSUE}"`, the same default every other
 * pipeline step already applies when a target has no parent). PURE — #2152.
 *
 * A solo leaf's pipeline-block `epic=` field (when it survives to close-time at all — often
 * absent, #2152) equals its OWN issue number, exactly like a genuine multi-child epic closing
 * directly instead of via `/close-epic`. The only thing that tells them apart is whether the
 * resolved epic number actually has real GitHub sub-issues — a solo leaf never does.
 *
 *   closedIssueNumber: number        — the issue whose `issues: closed` event fired this
 *   blockEpicNumber:   number|null   — `epic=` from its pipeline block, if any
 *   subIssueCount:     number        — real sub-issues already fetched for the resolved epic number
 *
 * Returns { epicNumber, isSolo }. When isSolo is true, the caller should treat the closed issue
 * itself as its epic's one completed child (`subIssues = [{ state: 'closed' }]`) rather than
 * skipping — that's the #2152 fix. When isSolo is false and epicNumber === closedIssueNumber,
 * the caller should keep the original #1815 behaviour: skip, defer to `/close-epic` (#856).
 */
export function resolveEpicTarget({ closedIssueNumber, blockEpicNumber = null, subIssueCount = 0 }) {
  const epicNumber = blockEpicNumber ?? closedIssueNumber
  const isSolo = epicNumber === closedIssueNumber && subIssueCount === 0
  return { epicNumber, isSolo }
}

/**
 * Decide whether to open the epic→main PR. PURE.
 *   subIssues:           [{ state: 'open'|'closed' }]  — the epic's DIRECT sub-issues
 *   existingEpicMainPrs: [ ... ]                        — OPEN PRs already head=epic-branch base=main
 *   aheadCount:          number                         — commits the epic branch is ahead of main
 * Open iff the epic HAS children, ALL are closed, the branch actually landed work, and no PR exists.
 * Any miss returns a human-readable `reason` (logged, never thrown — a false skip is safe, a false
 * open is not, so the predicate is deliberately conservative).
 */
export function decideOpen({ subIssues = [], existingEpicMainPrs = [], aheadCount = 0 } = {}) {
  if (existingEpicMainPrs.length > 0) return { open: false, reason: 'epic→main PR already open' }
  if (subIssues.length === 0) return { open: false, reason: 'epic has no sub-issues' }
  const openChildren = subIssues.filter(s => s.state !== 'closed').length
  if (openChildren > 0) return { open: false, reason: `${openChildren} child issue(s) still open` }
  if (aheadCount <= 0) return { open: false, reason: 'epic branch has no commits ahead of main' }
  return { open: true, reason: `all ${subIssues.length} children closed + branch ${aheadCount} ahead of main` }
}
