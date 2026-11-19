#!/usr/bin/env node
// require-unclaimed.mjs — PreToolUse gate for Bash, mcp__github__issue_write and
// mcp__github__add_issue_comment (#3996).
//
// Every interactive chat posts as the same account, so one chat's "fill the pipeline" sweep
// started tickets another chat was driving (#3988, #3953 on 2026-11-16). A chat now CLAIMS what it
// drives (`node scripts/claim.mjs claim <n>`); this hook refuses, for a ticket another live chat
// claimed (directly or through its parent epic):
//   - adding `work-this`, removing `status:blocked`, and a `**Worker:**` comment on its PR;
// and, for any chat, adding `work-this` to a ticket whose `Blocked-by:` issue is still open.
//
// Decisions are in scripts/lib/chat-claim.mjs (unit-tested via scripts/claim.test.mjs); this file
// is plumbing. Exit 2 cancels the call and sends stderr back to the agent. Unrelated calls return
// before any network. Any GitHub lookup failure fails OPEN with a note — an outage must not
// freeze every chat (same choice as require-live-review-target.mjs).
import { readFileSync } from 'node:fs'
import {
  confirmLabelChange, decideClaimGuard, detectGuardedAction, hasWorkerLine, shortChatId, ticketFromPr,
} from '../../scripts/lib/chat-claim.mjs'
import { claimChain, loadFacts } from '../../scripts/claim.mjs'
import { parseBlockers } from '../../scripts/wave-gate.mjs'

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input = {}
  try { input = JSON.parse(raw) || {} } catch { process.exit(0) }
  const action = detectGuardedAction(input.tool_name, input.tool_input || {})
  if (!action) process.exit(0)

  if (action.bodyFile) {
    let body = ''
    try { body = readFileSync(action.bodyFile, 'utf8') } catch { process.exit(0) }
    if (!hasWorkerLine(body)) process.exit(0)
  }

  // `$n` / `{}` / xargs: no ticket to look up, so refuse before any network.
  if (action.unresolved) {
    process.stderr.write(decideClaimGuard({ action }).reason + '\n')
    process.exit(2)
  }

  let verdict
  try {
    const facts = loadFacts()
    let ticket = action.number
    if (action.needsPrMap) {
      const pr = facts.pr(action.number)
      if (pr) {
        ticket = ticketFromPr(pr)
        if (!ticket) process.exit(0) // a PR that names no ticket — nothing to protect
      }
    }
    const issue = facts.issue(ticket)
    if (!confirmLabelChange(action, issue.labels)) process.exit(0)
    const openBlockers = action.kind === 'add-work-this'
      ? parseBlockers(issue.body).filter(b => String(facts.issue(b).state).toLowerCase() === 'open')
      : []
    const claims = claimChain(facts, ticket, issue)
    const myChat = shortChatId(input.session_id) || String(process.env.CROUTON_CHAT_ID || '').toLowerCase()
    verdict = decideClaimGuard({ action: { ...action, ticket }, myChat, claims, openBlockers })
  } catch (e) {
    process.stderr.write(`require-unclaimed: lookup failed, allowing (${`${e.stderr || e.message || e}`.trim().split('\n')[0]})\n`)
    process.exit(0)
  }
  if (verdict.allow) process.exit(0)
  process.stderr.write(verdict.reason + '\n')
  process.exit(2)
})
