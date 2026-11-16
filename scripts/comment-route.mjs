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
//   owner screen (#3691): a 🎯/📐 comment from the Nuxt Harness app on a waiting item — a
//          status:blocked issue, or a PR whose SOURCE issue (`Closes #N`, passed in as
//          `pr.sourceIssue`) is status:blocked (scripts/lib/owner-screens.mjs) → resume on a pipeline-owned issue / revise on a
//          pi PR, else none. Checked BEFORE the bot drop, and it never reaches the approval,
//          quiz, test-card or interpret routes — it is feedback, never an `ok`.
//   issue: owner `/fresh-branch` on an `epic` → fresh-branch (#3881) · /close-epic → close-epic · slash/rocket command → dispatch · quiz-shaped owner reply
//          (`1B 2A 3C`, `2 code`) → quiz-reply (before test-card/resume, so a quiz answer never
//          resumes, approves or re-plans anything; #3715) · `ok`/`not ok:` on a
//          status:to-test card → test-card (beats resume: that `ok` answers the card) ·
//          owner reply on a plan rejected twice → approve-plan (`ok: <reason>`) /
//          plan-needs-reason (bare approval) (#3272; other replies fall through to the re-plan) ·
//          status:blocked → resume (pipeline-owned tickets; else `interpret`) · an approval on an un-blocked issue → resume with
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
import { routePrComment } from './revise-route.mjs'
import { isQuizReply } from './owner-quiz.mjs'
import { isOwnerScreenComment } from './lib/owner-screens.mjs'
import { parseOverride } from './lib/decision-line.mjs'

export const KINDS = [
  'approve-draft', 'approve-epic', 'approve-plan', 'automerge-go', 'close-epic',
  'dispatch', 'fresh-branch', 'interpret', 'plan-needs-reason', 'quiz-reply', 'resume', 'revise', 'test-card', 'none',
]

const COLLABORATORS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])
const OWNERS = new Set(['OWNER', 'MEMBER'])

/** Whole-word `/close-epic` as a command (not mentioned in code or a quote). */
const CLOSE_EPIC = /(^|\s)\/close-epic(\s|$)/i

/** `/fresh-branch` alone on its own line (#3881) — never mid-sentence, in code or in a quote. */
const FRESH_BRANCH = /^\s*\/fresh-branch\s*$/im

/**
 * A ticket the pipeline owns: its body carries the hidden `<!-- pipeline:` marker, or it holds a
 * delegate-style label. Only those have a resume job that does something with a reply (#2980).
 */
export function isPipelineOwned({ body = '', labels = [] } = {}) {
  return String(body).includes('<!-- pipeline:') || labels.some(l => /^(delegate|delegate-pi|work-this)$/.test(l))
}

/**
 * Owner override on a plan held by two no-go verdicts (#3272; `issue.planHeld` from plan-held.mjs
 * planHeldFor): `ok: <reason>` approves; a bare approval asks for the reason; anything else → null.
 */
function routeHeldPlan({ body, assoc, issue, out, userType }) {
  if (!(out.blocked && issue.planHeld && OWNERS.has(assoc))) return null
  if (parseOverride({ body, authorAssociation: assoc, userType })) return out('approve-plan', 'owner ok: <reason> on a twice-rejected plan')
  if (isApproval(body)) return out('plan-needs-reason', 'bare approval on a twice-rejected plan')
  return null
}

/** An explicit command on an issue: /fresh-branch, /close-epic or a pipeline command; else null. */
function routeIssueCommand({ body, assoc, collab, labels, out }) {
  const text = stripNonCommandRegions(body)
  if (OWNERS.has(assoc) && labels.includes('epic') && FRESH_BRANCH.test(text)) return out('fresh-branch', '/fresh-branch command')
  if (CLOSE_EPIC.test(text)) return out('close-epic', '/close-epic command')
  if (collab && parseCommand(body)) return out('dispatch', 'a pipeline command')
  return null
}

/** Routing for a comment on a plain issue. */
function routeIssue({ body, assoc, collab, issue, out, userType }) {
  const labels = issue.labels || []
  const command = routeIssueCommand({ body, assoc, collab, labels, out })
  if (command) return command
  if (isQuizReply(body)) {
    // owner-quiz-run.mjs reply() also checks the login is the pipeline owner; no quiz on the issue → it logs and exits.
    return OWNERS.has(assoc) ? out('quiz-reply', 'a reply to an owner quiz') : out('none', 'quiz-shaped reply from a non-owner')
  }
  if (collab && labels.includes('status:to-test') && parseTestReply(body).result) {
    return out('test-card', 'a reply to a test card')
  }
  const held = routeHeldPlan({ body, assoc, issue, out, userType })
  if (held) return held
  // A held ticket the pipeline does not own has nothing to resume: an approval still goes to the
  // resume job (it explains), any other owner comment falls through to `interpret`.
  if (out.blocked && (isPipelineOwned({ body: issue.body, labels }) || isApproval(body))) {
    return out('resume', 'a reply on a status:blocked issue')
  }
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
 * @param {{body:string, authorAssociation?:string, userType?:string, performedViaGithubApp?:string|null, appSlug?:string|null, userLogin?:string}} input.comment
 * @param {{number:number, isPr:boolean, labels?:string[]}} input.issue
 * @param {{headRef:string, baseRef:string, draft:boolean, state:string, sourceIssue?:{number:number, labels:string[]}|null}} [input.pr]  required when issue.isPr
 * @returns {{kind:string, number:number, reason:string, blocked:boolean}}
 */
export function routeComment(input = {}) {
  const d = routeBase(input)
  if (d.kind === 'none' && isInterpretable(input)) return { ...d, kind: 'interpret', reason: 'an owner comment that matches no command' }
  return d
}

/** Owner-only, human, non-empty, not an approval / slash command / `> 🤖` agent comment; a PR must be open. */
function isInterpretable({ comment = {}, issue = {}, pr } = {}) {
  const body = String(comment.body || '')
  if (!OWNERS.has(comment.authorAssociation) || comment.userType === 'Bot') return false
  if (comment.performedViaGithubApp) return false // only the owner's own typed comments are interpreted
  const first = body.split('\n').find(l => l.trim()) || ''
  if (!first) return false
  if (/^>\s*🤖/u.test(first.trim())) return false
  if (/^\//.test(first.trim()) || isApproval(body)) return false
  if (issue.isPr && (!pr || pr.state !== 'open')) return false
  return true
}

/**
 * An owner-screen comment: resume a pipeline-owned issue, revise a pi PR, else nothing. Never an
 * approval. On a PR the wait is judged on `pr.sourceIssue` (the `Closes #N` issue), not the PR.
 */
function routeOwnerScreen({ comment, issue, pr, out }) {
  if (!issue.isPr) {
    return isPipelineOwned({ body: issue.body, labels: issue.labels || [] })
      ? out('resume', 'an owner-screen comment on a status:blocked issue')
      : out('none', "owner-screen comment on a ticket the pipeline doesn't own")
  }
  if (!pr) return out('none', 'PR facts missing')
  const r = routePrComment({
    pr: { headRef: pr.headRef, state: pr.state, sourceIssue: pr.sourceIssue ?? null },
    comment: { body: comment.body, authorAssociation: comment.authorAssociation, userType: comment.userType, appSlug: comment.appSlug, userLogin: comment.userLogin },
  })
  return r.revise ? out('revise', r.reason) : out('none', r.reason)
}

function routeBase({ comment = {}, issue = {}, pr } = {}) {
  const number = issue.number ?? 0
  const blocked = (issue.labels || []).includes('status:blocked')
  const out = (kind, reason) => ({ kind, number, reason, blocked })
  out.blocked = blocked
  const body = String(comment.body || '')
  const assoc = comment.authorAssociation
  const collab = COLLABORATORS.has(assoc)

  // A 🎯/📐 owner-screen comment on a waiting item is the owner's answer (#3691) — before the bot drop.
  if (isOwnerScreenComment({ comment, issue, pr })) return routeOwnerScreen({ comment, issue, pr, out })
  if (comment.userType === 'Bot') return out('none', 'posted by a bot')
  // An App acting under a user identity is a bot too — except the Claude app, which the
  // interactive agent uses to post `**Worker:**` change requests as the owner (#3029).
  if (comment.performedViaGithubApp && comment.performedViaGithubApp !== 'Claude') return out('none', 'posted via a GitHub App')
  if (!body.trim()) return out('none', 'empty comment')

  if (!issue.isPr) return routeIssue({ body, assoc, collab, issue, out, userType: comment.userType })

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
