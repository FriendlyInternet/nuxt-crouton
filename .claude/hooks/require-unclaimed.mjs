#!/usr/bin/env node
// require-unclaimed.mjs — PreToolUse gate for Bash, mcp__github__issue_write,
// mcp__github__add_issue_comment and mcp__github__sub_issue_write (#3996, #4517).
//
// Every interactive chat posts as the same account, so one chat's "fill the pipeline" sweep
// started tickets another chat was driving (#3988, #3953 on 2026-11-16). A chat now CLAIMS what it
// drives (`node scripts/claim.mjs claim <n>`); this hook refuses, for a ticket another live chat
// claimed (directly or through its parent epic):
//   - adding `work-this`, removing `status:blocked`, and a `**Worker:**` comment on its PR;
// for any chat, adding `work-this` to a ticket whose `Blocked-by:` issue is still open;
// and (#4517) putting a ticket under an epic (`--parent`, `--add-sub-issue`, REST `sub_issues`,
// GraphQL `addSubIssue`, MCP `sub_issue_write`) when it is already being built — `work-this`,
// `plan:approved`, `status:blocked` or an open `work-<n>` PR — unless this chat holds its claim.
// The label check and the adopt check BOTH run on a call; the first refusal refuses it.
//
// Decisions are in scripts/lib/chat-claim.mjs (unit-tested via scripts/claim.test.mjs); this file
// is plumbing. Exit 2 cancels the call and sends stderr back to the agent. Unrelated calls return
// before any network. Any GitHub lookup failure fails OPEN with a note — an outage must not
// freeze every chat (same choice as require-live-review-target.mjs).
import { readFileSync } from 'node:fs'
import {
  confirmLabelChange, decideAdoptGuard, decideClaimGuard, detectAdopts, detectGuardedAction,
  hasWorkerLine, issueNodeId, shortChatId, ticketFromPr,
} from '../../scripts/lib/chat-claim.mjs'
import { claimChain, loadFacts } from '../../scripts/claim.mjs'
import { parseBlockers } from '../../scripts/wave-gate.mjs'

/** A `--body-file` comment counts only when the file has a **Worker:** line. */
function labelActionOf(action) {
  if (!action || !action.bodyFile) return action
  try {
    return hasWorkerLine(readFileSync(action.bodyFile, 'utf8')) ? action : null
  } catch {
    return null
  }
}

/** The existing label/comment rule → a refusal reason, or '' (allowed or nothing to check). */
function labelReason(facts, action, myChat) {
  let ticket = action.number
  if (action.needsPrMap) {
    const pr = facts.pr(action.number)
    if (pr) {
      ticket = ticketFromPr(pr)
      if (!ticket) return '' // a PR that names no ticket — nothing to protect
    }
  }
  const issue = facts.issue(ticket)
  if (!confirmLabelChange(action, issue.labels)) return ''
  const openBlockers = action.kind === 'add-work-this'
    ? parseBlockers(issue.body).filter(b => String(facts.issue(b).state).toLowerCase() === 'open')
    : []
  const claims = claimChain(facts, ticket, issue)
  const verdict = decideClaimGuard({ action: { ...action, ticket }, myChat, claims, openBlockers })
  return verdict.allow ? '' : verdict.reason
}

/** The adopt rule over every child of every adopt → the first refusal reason, or ''. */
function adoptReason(facts, adopts, myChat) {
  let repoId, openPrs
  const childNumber = (c) => {
    if (c.number) return c.number
    if (c.childNode) return facts.numberOfNode(c.childNode)
    repoId ??= facts.repoId()
    return facts.numberOfNode(issueNodeId(repoId, c.childId))
  }
  for (const adopt of adopts) {
    for (const c of adopt.children) {
      const child = childNumber(c)
      const issue = facts.issue(child)
      openPrs ??= facts.openPrs()
      const verdict = decideAdoptGuard({ child, issue, myChat, claims: claimChain(facts, child, issue), openPrs })
      if (!verdict.allow) return verdict.reason
    }
  }
  return ''
}

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input = {}
  try { input = JSON.parse(raw) || {} } catch { process.exit(0) }
  const action = labelActionOf(detectGuardedAction(input.tool_name, input.tool_input || {}))
  const adopts = detectAdopts(input.tool_name, input.tool_input || {})
  if (!action && !adopts.length) process.exit(0)

  // `$n` / `{}` / xargs: no ticket to look up, so refuse before any network.
  const stuck = [action, ...adopts].find(a => a && a.unresolved)
  if (stuck) {
    process.stderr.write(decideClaimGuard({ action: stuck }).reason + '\n')
    process.exit(2)
  }

  let reason = ''
  try {
    const facts = loadFacts()
    const myChat = shortChatId(input.session_id) || String(process.env.CROUTON_CHAT_ID || '').toLowerCase()
    if (action) reason = labelReason(facts, action, myChat)
    if (!reason && adopts.length) reason = adoptReason(facts, adopts, myChat)
  } catch (e) {
    process.stderr.write(`require-unclaimed: lookup failed, allowing (${`${e.stderr || e.message || e}`.trim().split('\n')[0]})\n`)
    process.exit(0)
  }
  if (!reason) process.exit(0)
  process.stderr.write(reason + '\n')
  process.exit(2)
})
