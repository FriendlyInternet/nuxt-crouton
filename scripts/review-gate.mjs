#!/usr/bin/env node
// Review-gate decision (#3070): a reviewer that did not run never shows as a pass.
//   node scripts/review-gate.mjs <reviewer> <verdict-file> <classification> [agent-log-file]
// exit 0 = a verdict exists (severity thresholds stay in the workflow step);
// exit 1 = no usable verdict; stdout is the PR comment to post.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const markerFor = reviewer => `<!-- review-gate:${reviewer} -->`

export function decide({ reviewer, verdictPath, classification, logPath }) {
  let ok = false
  if (verdictPath && existsSync(verdictPath)) {
    try {
      const v = JSON.parse(readFileSync(verdictPath, 'utf8'))
      ok = v !== null && typeof v === 'object'
    }
    catch { ok = false }
  }
  if (ok) return { pass: true, message: '' }
  return {
    pass: false,
    message: `🔴 ${reviewer} did not run (refused, crashed or out of credit — the action reports no reason). This PR is not approved; open the run, fix the cause, re-run.\n\n${markerFor(reviewer)}`,
  }
}

/** Every comment carrying this reviewer's marker, whatever commit it was posted on. */
export function markersToDelete(comments, reviewer) {
  const m = markerFor(reviewer)
  return comments.filter(c => typeof c.body === 'string' && c.body.includes(m))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [reviewer, verdictPath, classification, logPath] = process.argv.slice(2)
  const r = decide({ reviewer, verdictPath, classification, logPath })
  if (!r.pass) {
    process.stdout.write(r.message + '\n')
    process.exit(1)
  }
}
