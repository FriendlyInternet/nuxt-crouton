#!/usr/bin/env node
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

const COLLABORATOR = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/** `work-2414` → 2414; anything else → null. The pi worker always pushes to `work-<issue>`. */
export function workIssueFromRef(ref) {
  const m = /^work-(\d+)$/.exec(String(ref || ''))
  return m ? Number(m[1]) : null
}

/**
 * Should this comment revise the PR?
 *
 * @param {object} c
 * @param {string} c.body               the comment text
 * @param {string} [c.authorAssociation] OWNER / MEMBER / COLLABORATOR / …
 * @param {string} [c.userType]          'User' or 'Bot'
 * @returns {{ revise: boolean, reason: string }}
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
    if (!addressesWorker) return { revise: false, reason: 'an interactive-agent comment without a **Worker:** line' }
    return { revise: true, reason: 'an interactive-agent change request addressed to the worker' }
  }
  if (isApproval(text)) return { revise: false, reason: 'an approval — approve-draft-pr releases it' }
  if (parseCommand(text)) return { revise: false, reason: 'a pipeline command, not feedback' }
  if (/^\//.test(text)) return { revise: false, reason: 'a slash command' }
  return { revise: true, reason: 'a change request from a collaborator' }
}

/**
 * The PR side: a comment on an OPEN PR whose head is `work-<N>`.
 * @returns {{ revise: boolean, issue: number|null, reason: string }}
 */
export function routePrComment({ pr = {}, comment = {} } = {}) {
  const issue = workIssueFromRef(pr.headRef)
  if (!issue) return { revise: false, issue: null, reason: `head \`${pr.headRef}\` is not a pi worker branch` }
  if (pr.state !== 'open') return { revise: false, issue, reason: 'the PR is not open' }
  const d = shouldRevise(comment)
  return { revise: d.revise, issue, reason: d.reason }
}

// CLI: `node scripts/revise-route.mjs pr < event.json` → prints {revise,issue,reason}.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { readFileSync } = await import('node:fs')
  const ev = JSON.parse(readFileSync(0, 'utf8'))
  console.log(JSON.stringify(routePrComment(ev)))
}
