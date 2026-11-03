#!/usr/bin/env node
// epic-branch-keep.mjs — the pure "keep this epic branch?" decision (#2788).
//
// WHY. An `epic/<N>-*` branch was deleted the moment its first epic→main PR merged, even while
// epic #N stayed open. Later fixes to the same epic (#2748, #2764) then had no branch to land on
// and their workers produced nothing. The branch belongs to the EPIC, so it lives exactly as long
// as the epic issue is open. The GitHub I/O stays in the callers; this is the testable decision.
//   node --test scripts/epic-branch-keep.test.mjs

import { parseEpicNumber } from './epic-ready.mjs'

/**
 * Should the cleanup jobs leave this branch alone?
 *   branch:    ref name, e.g. `epic/2706-pipeline-tightening-friction`
 *   epicState: 'open' | 'closed' | null/undefined (unknown — issue lookup failed or not found)
 * Keep when the epic is open. Unknown state also keeps: a wrongly kept branch is harmless and
 * the janitor retries; a wrongly deleted one stalls every later child of the epic.
 * Non-epic branches are not this rule's business → false (callers apply their own rules).
 */
export function shouldKeepEpicBranch(branch, epicState) {
  if (parseEpicNumber(branch) === null) return false
  return String(epicState || '').toLowerCase() !== 'closed'
}
