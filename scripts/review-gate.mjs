#!/usr/bin/env node
// Review-gate decision (#3070): a reviewer that did not run never shows as a pass.
//   node scripts/review-gate.mjs <reviewer> <verdict-file> <classification>
// exit 0 = a verdict exists (severity thresholds stay in the workflow step);
// exit 1 = no usable verdict; stdout is the PR comment to post.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REASONS = {
  billing_error: 'the API key is out of credit',
  error_max_turns: 'it ran out of turns before finishing',
  auth_error: 'the API rejected the key',
  agent_error: 'it crashed before finishing',
  no_verdict: 'it finished but wrote no result',
}

export const markerFor = reviewer => `<!-- review-gate:${reviewer} -->`

export function decide({ reviewer, verdictPath, classification }) {
  let ok = false
  if (verdictPath && existsSync(verdictPath)) {
    try {
      const v = JSON.parse(readFileSync(verdictPath, 'utf8'))
      ok = v !== null && typeof v === 'object'
    }
    catch { ok = false }
  }
  if (ok) return { pass: true, message: '' }
  const reason = REASONS[classification] || 'it produced no usable result'
  return {
    pass: false,
    message: `🔴 ${reviewer} did not run (${reason}). This PR is not approved; re-run the check or fix the reviewer.\n\n${markerFor(reviewer)}`,
  }
}

/** Every comment carrying this reviewer's marker, whatever commit it was posted on. */
export function markersToDelete(comments, reviewer) {
  const m = markerFor(reviewer)
  return comments.filter(c => typeof c.body === 'string' && c.body.includes(m))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [reviewer, verdictPath, classification] = process.argv.slice(2)
  const r = decide({ reviewer, verdictPath, classification })
  if (!r.pass) {
    process.stdout.write(r.message + '\n')
    process.exit(1)
  }
}
