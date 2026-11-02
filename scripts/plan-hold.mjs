// Is this issue held on a plan the reviewer rejected? (#3116)
//
// A reply on such an issue must re-run the planner with the reply as feedback. It used to reach the
// generic resume responder, which posted "still iterating" and nothing else. Detection mirrors how
// plan-review.yml decides to hold: two or more `plan-review-verdict:no-go` comments plus
// `status:blocked`. A later `go` / `needs-owner` verdict, a verdict posted by a person, a
// `plan:approved` label, or an approval reply (`ok`) does not count — approval is not a re-plan.

import { isApproval } from './approval.mjs'

const VERDICT = /<!--\s*plan-review-verdict:(go|no-go|needs-owner)\s*-->/

const isHuman = (c) => c?.userType === 'User' || c?.user?.type === 'User'

/** Newest plan-review verdicts, oldest first, bot-authored only. */
function verdicts(comments) {
  const out = []
  for (const c of comments || []) {
    if (isHuman(c)) continue
    const m = VERDICT.exec(c?.body || '')
    if (m) out.push(m[1])
  }
  return out
}

/**
 * True when the issue is held on a rejected plan and `replyBody` is feedback, not an approval.
 * @param {{comments?: object[], labels?: string[], replyBody?: string}} input
 */
export function isPlanHold({ comments, labels = [], replyBody = '' } = {}) {
  if (!labels.includes('status:blocked') || labels.includes('plan:approved')) return false
  if (replyBody && isApproval(replyBody)) return false
  const v = verdicts(comments)
  return v.length > 0 && v[v.length - 1] === 'no-go' && v.filter((x) => x === 'no-go').length >= 2
}

/**
 * What a finished resume run should report.
 *  replan  — the planner was dispatched with the reply as feedback
 *  nothing — plan hold, nothing dispatched, nothing posted: say so (🔴), never "still iterating"
 *  ok      — anything else keeps the existing artifact-gate behaviour
 */
export function resumeOutcome({ planHold, dispatched, newComment }) {
  if (!planHold) return 'ok'
  if (dispatched) return 'replan'
  return newComment ? 'ok' : 'nothing'
}
