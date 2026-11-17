// Is this issue held on a plan the reviewer rejected, or on a plan-review question? (#3116)
//
// A reply on such an issue must re-run the planner with the reply as feedback. It used to reach the
// generic resume responder, which posted "still iterating" and nothing else. Detection mirrors how
// on-comment.yml's plan-review job decides to hold: two or more `plan-review-verdict:no-go` comments plus
// `status:blocked`, or a newest `needs-owner` verdict (#3564 — plan review holds on it and the
// owner's answer is the only restart). A later `go` verdict, a verdict posted by a person or a
// `plan:approved` label does not count. On the twice-rejected hold an approval reply (`ok`) is not a
// re-plan (the router asks for a reason). On a `needs-owner` hold every reply re-plans, and the
// owner's bare `ok` is first recorded in `## Decisions` as the answer "yes" (#4082).

import { isApproval, isBareApproval } from './approval.mjs'
import { markerValue } from './lib/marker.mjs'
import { OWNERS, decisionLine } from './lib/decision-line.mjs'

const VERDICT = /<!--\s*plan-review-verdict:(go|no-go|needs-owner)\s*-->/

// `ok: <reason>` is an approval with a reason (the #3041 override), never a re-plan.
const OK_REASON = /^[ \t\r\n]*ok[ \t]*:/i

const isHuman = (c) => c?.userType === 'User' || c?.user?.type === 'User'

/** Newest plan-review verdicts, oldest first, bot-authored only. */
function verdicts(comments) {
  const out = []
  for (const c of comments || []) {
    if (isHuman(c)) continue
    const v = markerValue(c?.body || '', VERDICT)
    if (v) out.push(v)
  }
  return out
}

/**
 * True when the issue is held on a plan and `replyBody` should re-run the planner.
 * Newest verdict `needs-owner`: any reply re-plans, approvals included (an owner's bare `ok` is the
 * answer "yes", recorded by `answerDecision` — #4082). Twice-rejected hold: an approval is not a re-plan.
 * @param {{comments?: object[], labels?: string[], replyBody?: string}} input
 */
export function isPlanHold({ comments, labels = [], replyBody = '' } = {}) {
  if (!labels.includes('status:blocked') || labels.includes('plan:approved')) return false
  const v = verdicts(comments)
  if (v.at(-1) === 'needs-owner') return true
  if (replyBody && (isApproval(replyBody) || OK_REASON.test(replyBody))) return false
  return isRejectedTwice({ comments, labels })
}

const CALL = '**Needs your call** — '

/**
 * The question of the newest bot `needs-owner` verdict, as one line; `''` when the newest verdict
 * is not `needs-owner`. Reads the shape plan-verdict.mjs `renderComment` writes (#4082).
 * @param {object[]} comments
 */
export function needsOwnerQuestion(comments) {
  if (verdicts(comments).at(-1) !== 'needs-owner') return ''
  const c = [...(comments || [])].reverse().find((x) => !isHuman(x) && markerValue(x?.body || '', VERDICT) === 'needs-owner')
  const body = String(c?.body || '')
  const at = body.indexOf(CALL)
  if (at < 0) return ''
  const lines = body.slice(at + CALL.length).split('\n')
  const end = lines.findIndex((l) => /^\s*\*\*Needs:\*\*/.test(l))
  const q = (end < 0 ? lines : lines.slice(0, end)).filter((l) => l.trim())
  if (q.length && /^\s*yes\s*\/\s*no\s*$/i.test(q.at(-1))) q.pop()
  return q.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * The `## Decisions` line for the owner's bare approval on a `needs-owner` hold, or null (#4082).
 * Only the owner (same trust check as `parseDecision`). `ok: <reason>` is null: the record-decision
 * job already writes that one, and two writers must not race on the issue body.
 * @param {{comments?: object[], replyBody?: string, date?: string, url?: string, authorAssociation?: string, userType?: string}} input
 */
export function answerDecision({ comments, replyBody = '', date, url, authorAssociation, userType } = {}) {
  if (userType === 'Bot' || !OWNERS.has(authorAssociation)) return null
  if (verdicts(comments).at(-1) !== 'needs-owner') return null
  if (!isBareApproval(replyBody) || OK_REASON.test(replyBody)) return null
  const q = needsOwnerQuestion(comments)
  return decisionLine({ text: `owner answered yes (\`ok\`) to the plan review's question: "${q}"`, date, url })
}

/**
 * True when the plan is held after two reviewer rejections (#3272): `status:blocked`, no
 * `plan:approved`, the newest bot verdict is `no-go` and there are at least two. A `needs-owner`
 * hold is NOT this — the owner override (`ok: <reason>`) applies only to the twice-rejected hold.
 * @param {{comments?: object[], labels?: string[]}} input
 */
export function isRejectedTwice({ comments, labels = [] } = {}) {
  if (!labels.includes('status:blocked') || labels.includes('plan:approved')) return false
  const v = verdicts(comments)
  return v[v.length - 1] === 'no-go' && v.filter((x) => x === 'no-go').length >= 2
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

/**
 * The workflow_dispatch a held-plan reply makes: re-run the planner with the reply as feedback.
 * @param {{issue: number|string, commentId: number|string}} input
 */
export function replanDispatch({ issue, commentId }) {
  return {
    workflow_id: 'work-issue-pidev.yml',
    inputs: { issue: String(issue), mode: 'plan', feedback: String(commentId) },
  }
}
