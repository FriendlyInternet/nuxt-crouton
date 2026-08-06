#!/usr/bin/env node
// require-owner-brief.mjs — PreToolUse gate for mcp__github__add_issue_comment (#2081).
//
// Sibling of require-comment-provenance.mjs: that one makes the SOURCE unmistakable, this one
// makes the POINT unmistakable. An agent comment is a notification to someone holding ~20
// async threads on a phone, so it must lead with a short typed brief and link to the depth.
//
// The depth is not the problem and is never cut — anything inside <details>, a code fence, the
// provenance blockquote or the generated-by footer costs nothing against the limits.
//
// The decision lives in scripts/owner-brief.mjs (pure, unit-tested, corpus-checked); this file
// is only the plumbing. Exit 2 cancels the call and sends stderr back to the agent.
import { checkOwnerBrief, explain } from '../../scripts/owner-brief.mjs'

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let body = ''
  try { body = ((JSON.parse(raw).tool_input) || {}).body || '' } catch { process.exit(0) }
  // Unparseable input fails OPEN: a gate about comment SHAPE must never be the reason a
  // finding goes unreported. require-comment-provenance already fails closed on identity,
  // which is the property worth being strict about.

  const verdict = checkOwnerBrief(body)
  if (verdict.ok) process.exit(0)

  process.stderr.write(explain(verdict) + '\n')
  process.exit(2)
})
