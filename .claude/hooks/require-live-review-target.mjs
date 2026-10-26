#!/usr/bin/env node
// require-live-review-target.mjs — PreToolUse gate for mcp__github__add_issue_comment (#2111).
//
// Third sibling of require-comment-provenance (WHO) and require-owner-brief (WHAT): this one
// checks WHERE. A comment that asks the owner to act and names a PR in its `**You:**` line must
// name a PR that is still open — on 2026-08-06 a hold sent the owner to #2039, already merged.
//
// The decision lives in scripts/review-target.mjs (pure, unit-tested, corpus-checked: 0 of the 25
// asking comments in the last 300 named a PR there, so it refuses nothing it shouldn't). This file
// is plumbing. Exit 2 cancels the call and sends stderr back to the agent. Any input or lookup
// failure fails OPEN — a check about where to look must never block a finding from being reported.
import { checkReviewTargets, explainStale } from '../../scripts/review-target.mjs'

let raw = ''
process.stdin.on('data', (c) => { raw += c })
process.stdin.on('end', () => {
  let input = {}
  try { input = JSON.parse(raw).tool_input || {} } catch { process.exit(0) }
  const repo = input.owner && input.repo ? `${input.owner}/${input.repo}` : undefined
  let verdict
  try {
    verdict = checkReviewTargets(input.body || "", { repo })
  } catch { process.exit(0) }
  if (verdict.ok) process.exit(0)
  process.stderr.write(explainStale(verdict.stale) + '\n')
  process.exit(2)
})
