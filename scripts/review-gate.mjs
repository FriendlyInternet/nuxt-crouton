#!/usr/bin/env node
// Review-gate decision (#3070): a reviewer that did not run never shows as a pass.
//   node scripts/review-gate.mjs <reviewer> <verdict-file> <classification> [agent-log-file]
// exit 0 = a verdict exists (severity thresholds stay in the workflow step);
// exit 1 = no usable verdict; stdout is the PR comment to post.
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const markerFor = reviewer => `<!-- review-gate:${reviewer} -->`

// These reviewers only advise: nothing ties their verdict to the code (the same run has written
// "1 high" in the file and "no findings" in its comment), so they never turn the check red.
// frontend-review is the one reviewer decided by a text rule (scripts/frontend-gate.mjs).
export const ADVISORY = new Set(['red-team', 'a11y', 'simplify'])

const WORKFLOW = '.github/workflows/review.yml'

/** The Claude review tool refuses a run whose review.yml differs from main's (#4237). */
export const workflowIsStale = ({ localSha, mainSha } = {}) => Boolean(localSha && mainSha && localSha !== mainSha)

export function decide({ reviewer, verdictPath, classification, logPath, workflowStale = false }) {
  let ok = false
  if (verdictPath && existsSync(verdictPath)) {
    try {
      const v = JSON.parse(readFileSync(verdictPath, 'utf8'))
      ok = v !== null && typeof v === 'object'
    }
    catch { ok = false }
  }
  if (ok) return { pass: true, message: '' }
  if (workflowStale) {
    const why = `${reviewer} did not run: this branch's review workflow differs from the one on \`main\` (usually it is older), and the Claude review tool refuses to run then. Bring \`main\` into this PR's branch (for a PR into an epic branch: into the epic branch first, then update this PR) and the check runs again.`
    return {
      pass: false,
      message: ADVISORY.has(reviewer)
        ? `⚪ ${why} It only advises, so this does not block the PR.\n\n${markerFor(reviewer)}`
        : `🔴 ${why} Until then this PR is not approved.\n\n${markerFor(reviewer)}`,
    }
  }
  return {
    pass: false,
    message: ADVISORY.has(reviewer)
      ? `⚪ ${reviewer} did not run (refused, crashed or out of credit — the action reports no reason). It only advises, so this does not block the PR.\n\n${markerFor(reviewer)}`
      : `🔴 ${reviewer} did not run (refused, crashed or out of credit — the action reports no reason). This PR is not approved; open the run, fix the cause, re-run.\n\n${markerFor(reviewer)}`,
  }
}

/** Every comment carrying this reviewer's marker, whatever commit it was posted on. */
export function markersToDelete(comments, reviewer) {
  const m = markerFor(reviewer)
  return comments.filter(c => typeof c.body === 'string' && c.body.includes(m))
}

/** Best effort: this checkout's review.yml against the default branch's. Any failure ⇒ unknown ⇒ not stale. */
function probeWorkflowStale(env = process.env) {
  if (!env.GITHUB_REPOSITORY) return false
  const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim()
  try {
    let branch = 'main'
    try { branch = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).repository.default_branch || branch } catch { /* keep main */ }
    const localSha = sh('git', ['hash-object', WORKFLOW])
    const mainSha = sh('gh', ['api', `repos/${env.GITHUB_REPOSITORY}/contents/${WORKFLOW}?ref=${encodeURIComponent(branch)}`, '--jq', '.sha'])
    return workflowIsStale({ localSha, mainSha })
  }
  catch { return false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [reviewer, verdictPath, classification, logPath] = process.argv.slice(2)
  let r = decide({ reviewer, verdictPath, classification, logPath })
  if (!r.pass && probeWorkflowStale()) r = decide({ reviewer, verdictPath, classification, logPath, workflowStale: true })
  if (!r.pass) {
    process.stdout.write(r.message + '\n')
    process.exit(1)
  }
}
