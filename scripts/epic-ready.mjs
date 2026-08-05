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
