#!/usr/bin/env node
// layer: harness
// revise-route.mjs — is this comment a CHANGE REQUEST for a pi-built PR? (#2446)
//
// WHY. The owner reviews a pipeline PR on its preview and leaves feedback on the PR. `lgtm`
// there already works (approve-draft-pr.yml, #2051), but a change request reached nothing,
// and the same request on the issue went to a responder that cannot edit a pi-built PR — it
// answered "✅ resumed", changed nothing (seen on #2414/#2420). The fix is to re-run the pi
// worker on the PR's own branch with the comment as its instruction. This module is the one
// decision both entry points (the PR comment and the issue reply) use, so they can't drift.

import { pathToFileURL } from 'node:url'
import { isApproval } from './approval.mjs'
import { parseCommand } from './comment-command.mjs'

/** The skip reason a 🛠 action comment gets a "not sent to the worker" reply for (#2707). */
export const IGNORED_AGENT_REASON = 'an interactive-agent comment without a **Worker:** line'

const COLLABORATOR = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** `work-2414` → 2414; anything else → null. The pi worker always pushes to `work-<issue>`. */
export function workIssueFromRef(ref) {
  const m = /^work-(\d+)$/.exec(String(ref || ''))
  return m ? Number(m[1]) : null
}

/** `epic/2754-plan-before-build` → 2754; anything else → null. An epic → main PR's head (#2875). */
export function epicIssueFromRef(ref) {
  const m = /^epic\/(\d+)-/.exec(String(ref || ''))
  return m ? Number(m[1]) : null
}

/**
 * Should this comment revise the PR?
 *
 * @param {object} c
 * @param {string} c.body               the comment text
 * @param {string} [c.authorAssociation] OWNER / MEMBER / COLLABORATOR / …
 * @param {string} [c.userType]          'User' or 'Bot'
 * @returns {{ revise: boolean, reason: string, reply?: boolean }}
 */
export function shouldRevise({ body, authorAssociation, userType } = {}) {
  const text = String(body || '').trim()
  if (userType === 'Bot') return { revise: false, reason: 'posted by a bot' }
  if (!COLLABORATOR.has(authorAssociation)) return { revise: false, reason: 'not a repo collaborator' }
  if (!text) return { revise: false, reason: 'empty comment' }
  // Agent comments post from the owner's account (interactive sessions), so `userType` can't
  // tell them apart. The mandatory 🤖 provenance header can.
  // An agent comment (🤖 provenance header). The PIPELINE's own comments are never feedback.
  // An INTERACTIVE agent posts from the owner's account on the owner's behalf (#2453): its
  // status/FYI comments must not re-trigger a worker, but a change request it addresses to
  // the worker explicitly — a line starting `**Worker:**` — is the owner's feedback and revises.
  if (/^>\s*🤖/u.test(text)) {
    const interactive = /^>\s*🤖[^\n]*interactive agent/iu.test(text)
    const addressesWorker = /^\s*\*\*Worker:\*\*/mu.test(text)
    if (!interactive) return { revise: false, reason: 'a pipeline comment (🤖 header)' }
    // Only a 🛠 action brief reads like a request; status/FYI comments stay silent (#2707).
    if (!addressesWorker) {
      return { revise: false, reason: IGNORED_AGENT_REASON, reply: /^\s*🛠/mu.test(text) }
    }
    return { revise: true, reason: 'an interactive-agent change request addressed to the worker' }
  }
  if (isApproval(text)) return { revise: false, reason: 'an approval — approve-draft-pr releases it' }
  if (parseCommand(text)) return { revise: false, reason: 'a pipeline command, not feedback' }
  if (/^\//.test(text)) return { revise: false, reason: 'a slash command' }
  return { revise: true, reason: 'a change request from a collaborator' }
}

/**
 * The PR side: a comment on an OPEN PR whose head is `work-<N>` or `epic/<N>-…`.
 * `branch` is set only for an epic head: the dispatch must name it, since it is not `work-<issue>`.
 * @returns {{ revise: boolean, issue: number|null, branch: string, reason: string, reply: boolean }}
 */
export function routePrComment({ pr = {}, comment = {} } = {}) {
  const epic = epicIssueFromRef(pr.headRef)
  const issue = workIssueFromRef(pr.headRef) ?? epic
  const branch = epic ? pr.headRef : ''
  if (!issue) return { revise: false, issue: null, branch, reason: `head \`${pr.headRef}\` is not a pi worker or epic branch`, reply: false }
  if (pr.state !== 'open') return { revise: false, issue, branch, reason: 'the PR is not open', reply: false }
  const d = shouldRevise(comment)
  return { revise: d.revise, issue, branch, reason: d.reason, reply: Boolean(d.reply) }
}

// CLI: `node scripts/revise-route.mjs pr < event.json` → prints {revise,issue,reason}.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  const ev = JSON.parse(readFileSync(0, 'utf8'))
  console.log(JSON.stringify(routePrComment(ev)))
}
