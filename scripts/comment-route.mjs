#!/usr/bin/env node
// comment-route.mjs — ONE decision for "what does this comment mean?" (#2890, epic #2889)
//
// WHY. Nine workflows each listened to `issue_comment`, so every comment started nine runs
// and eight exited — and each read the owner's `ok` its own way (one matched `ok` inside
// "look", one had no `ok` at all on an epic PR, and `lgtm` on an epic PR started two merges
// in parallel). on-comment.yml now wakes once; this file decides which single job acts.
// "Is it an approval" is isApproval() from approval.mjs — the only definition.
//
// Pure and Node-core-only; the workflow fetches the facts (PR head/base/draft) and passes them in.
//
// PRECEDENCE (first match wins, so a comment can never start two acting jobs):
//   issue: /close-epic → close-epic · slash/rocket command → dispatch · `ok`/`not ok:` on a
//          status:to-test card → test-card (beats resume: that `ok` answers the card) ·
//          status:blocked → (owner `ok: <reason>` on a twice-rejected plan hold → approve-plan; bare `ok` there → plan-needs-reason) · resume · an approval on an un-blocked issue → resume with
//          blocked=false (the job only explains the skipped approval)
//   PR:    approval on a draft → approve-draft · approval on a ready epic→main PR from the
//          owner → approve-epic · any other approval → automerge-go · a non-approval on a
//          pi/epic branch → revise
//
// `automerge-go` and `approve-epic` never both fire for one comment — that was the
// lgtm-on-an-epic-PR double merge.

import { pathToFileURL } from 'node:url'
import { isApproval, parseTestReply } from './approval.mjs'
import { parseCommand, stripNonCommandRegions } from './comment-command.mjs'
import { overrideReason } from './plan-held.mjs'
import { routePrComment } from './revise-route.mjs'

export const KINDS = [
  'approve-draft', 'approve-epic', 'approve-plan', 'plan-needs-reason', 'automerge-go', 'close-epic',
  'dispatch', 'resume', 'revise', 'test-card', 'none',
]

const COLLABORATORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const OWNERS = new Set(['OWNER', 'MEMBER'])

/** Whole-word `/close-epic` as a command (not mentioned in code or a quote). */
const CLOSE_EPIC = /(^|\s)\/close-epic(\s|$)/i

/** Routing for a comment on a plain issue. */
function routeIssue({ body, collab, assoc, issue, out }) {
  const labels = issue.labels || []
  if (CLOSE_EPIC.test(stripNonCommandRegions(body))) return out('close-epic', '/close-epic command')
  if (collab && parseCommand(body)) return out('dispatch', 'a pipeline command')
  if (collab && labels.includes('status:to-test') && parseTestReply(body).result) {
    return out('test-card', 'a reply to a test card')
  }
  // On a plan held after two rejections the owner's `ok: <reason>` approves it (#3024) and the
  // reason is recorded as a decision; a bare `ok` only asks for the reason. Any other reply — or
  // `ok` from anyone else — still re-runs the planner via resume.
  if (out.blocked && issue.planHeld && OWNERS.has(assoc)) {
    if (overrideReason(body)) return out('approve-plan', 'owner override with a reason on a plan held after two rejections')
    if (isApproval(body)) return out('plan-needs-reason', 'bare approval on a held plan — ask for a reason')
  }
  if (out.blocked) return out('resume', 'a reply on a status:blocked issue')
  if (isApproval(body)) return out('resume', 'an approval on an issue that is not blocked (explain only)')
  return out('none', 'no command, no card reply, issue not blocked')
}

/** Routing for an approval (`ok`/`lgtm`) on a PR. */
function routePrApproval({ assoc, collab, pr, out }) {
  if (!collab) return out('none', 'approval from a non-collaborator')
  if (pr.state !== 'open') return out('none', 'PR is not open')
  if (pr.draft) return out('approve-draft', 'approval on a held draft PR')
  const epicToMain = pr.baseRef === 'main' && /^epic\//.test(pr.headRef || '')
  if (epicToMain && OWNERS.has(assoc)) return out('approve-epic', 'owner approval on an epic → main PR')
  return out('automerge-go', 'approval on a ready PR')
}

/**
 * @param {object} input
 * @param {{body:string, authorAssociation?:string, userType?:string, performedViaGithubApp?:string|null}} input.comment
 * @param {{number:number, isPr:boolean, labels?:string[], planHeld?:boolean}} input.issue
 * @param {{headRef:string, baseRef:string, draft:boolean, state:string}} [input.pr]  required when issue.isPr
 * @returns {{kind:string, number:number, reason:string, blocked:boolean}}
 */
export function routeComment({ comment = {}, issue = {}, pr } = {}) {
  const number = issue.number ?? 0
  const blocked = (issue.labels || []).includes('status:blocked')
  const out = (kind, reason) => ({ kind, number, reason, blocked })
  out.blocked = blocked
  const body = String(comment.body || '')
  const assoc = comment.authorAssociation
  const collab = COLLABORATORS.has(assoc)

  if (comment.userType === 'Bot') return out('none', 'posted by a bot')
  // An App acting under a user identity is a bot too — except the Claude app, which the
  // interactive agent uses to post `**Worker:**` change requests as the owner (#3029).
  if (comment.performedViaGithubApp && comment.performedViaGithubApp !== 'Claude') return out('none', 'posted via a GitHub App')
  if (!body.trim()) return out('none', 'empty comment')

  if (!issue.isPr) return routeIssue({ body, collab, assoc, issue, out })

  if (!pr) return out('none', 'PR facts missing')
  if (isApproval(body)) return routePrApproval({ assoc, collab, pr, out })
  const r = routePrComment({ pr: { headRef: pr.headRef, state: pr.state }, comment: { body, authorAssociation: assoc, userType: comment.userType } })
  if (r.revise || r.reply) return out('revise', r.reason)
  return out('none', r.reason)
}

// CLI: `node scripts/comment-route.mjs < facts.json` → prints the decision as JSON.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  console.log(JSON.stringify(routeComment(JSON.parse(readFileSync(0, 'utf8')))))
}
