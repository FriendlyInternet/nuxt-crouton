#!/usr/bin/env node
// epic-merge-decision.mjs — should the owner's `lgtm` on an epic PR into main merge it? (#2819)
//
// Pure decision; approve-epic-pr.yml only does the calls. The rule: an approval from the
// owner on an open, non-draft `epic/*` → `main` PR merges it iff BOTH aggregate gates
// reported success. Never merge over a red OR a missing gate — a gate that has not
// reported is "wait", not "pass" (the #1698 presence rule).

import { isApproval } from './approval.mjs'

export const REQUIRED_GATES = ['CI Gate', 'E2E Gate']
const OWNER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER'])

/** @param {{status:string, conclusion:string|null, name:string, completed_at?:string|null, started_at?:string|null}[]} runs */
function gateState(runs, name) {
  const mine = runs.filter(r => r.name === name)
  if (!mine.length) return 'missing'
  // Latest run wins (a re-run supersedes the earlier attempt).
  mine.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
  const r = mine[0]
  if (r.status !== 'completed') return 'pending'
  return r.conclusion === 'success' ? 'success' : 'failure'
}

/**
 * @param {{comment:{body:string, author_association:string, user?:{type?:string}},
 *          pr:{state:string, draft:boolean, head:{ref:string}, base:{ref:string}},
 *          checkRuns:object[]}} input
 * @returns {{action:'ignore'|'merge'|'wait'|'red', reason:string, failing:string[], pending:string[]}}
 */
export function decideEpicMerge({ comment, pr, checkRuns }) {
  const out = (action, reason, failing = [], pending = []) => ({ action, reason, failing, pending })
  if (comment.user?.type === 'Bot') return out('ignore', 'comment is from a bot')
  if (!OWNER_ASSOCIATIONS.has(comment.author_association)) return out('ignore', 'not from the owner')
  if (!isApproval(comment.body)) return out('ignore', 'not an approval')
  if (pr.state !== 'open') return out('ignore', 'PR is not open')
  if (pr.base.ref !== 'main') return out('ignore', 'base is not main')
  if (!/^epic\//.test(pr.head.ref)) return out('ignore', 'head is not an epic/* branch')
  if (pr.draft) return out('ignore', 'PR is a draft (approve-draft-pr releases it first)')

  const states = Object.fromEntries(REQUIRED_GATES.map(g => [g, gateState(checkRuns, g)]))
  const failing = REQUIRED_GATES.filter(g => states[g] === 'failure')
  if (failing.length) return out('red', `red gate: ${failing.join(', ')}`, failing)
  const pending = REQUIRED_GATES.filter(g => states[g] !== 'success')
  if (pending.length) return out('wait', `gate not finished: ${pending.join(', ')}`, [], pending)
  return out('merge', 'owner approved and both gates are green')
}
