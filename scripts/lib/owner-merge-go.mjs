// owner-merge-go.mjs — has the owner said "go" on a held PR? (#2832)
//
// The owner's `ok` (or legacy `lgtm`/`approve`) on a PR held for a human IS the merge
// decision: once checks are green the pipeline merges it, so no second trip to tap Merge.
// Pure decision only — the workflow supplies the PR's comments and commits.
//
// Rules: the approval must be by the owner, a real user comment (not a 🤖-headed agent
// comment — `isApproval` enforces that), the owner's latest verdict must not be a later
// `not ok`, any later owner comment that is neither (e.g. `ok, but rename X`) is a change
// request and resets the verdict, and no NON-MERGE commit may land after it (a worker revision
// needs a fresh `ok`; a plain "merge main/epic into branch" commit does not, and neither does a
// commit touching only `writeups/ui-proposals/**` — the bot's review-screenshot captures). The
// workflow supplies `files` (filenames) on each commit so those capture commits can be told apart.

import { isAgentComment, isApproval } from '../approval.mjs'

/**
 * @param {{ comments: Array<{user?: {login?: string, type?: string}, body?: string, created_at: string}>,
 *           commits: Array<{parents?: unknown[], files?: Array<string | {filename: string}>, commit?: {committer?: {date?: string}, author?: {date?: string}}}>,
 *           owner: string }} input
 * @returns {{ go: boolean, reason: string, approvedAt?: string }}
 */
export function ownerMergeGo({ comments = [], commits = [], owner }) {
  const mine = comments
    .filter(c => c.user?.login?.toLowerCase() === String(owner).toLowerCase() && c.user?.type !== 'Bot' && !isAgentComment(c.body))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  let verdict = null
  for (const c of mine) {
    if (isApproval(c.body)) verdict = { yes: true, at: c.created_at }
    else verdict = { yes: false, at: c.created_at } // `not ok`, or any other reply = change request
  }
  if (!verdict) return { go: false, reason: 'no owner approval' }
  if (!verdict.yes) return { go: false, reason: 'owner replied not ok (or asked for a change) after the last approval' }

  const approvedAt = new Date(verdict.at)
  const revised = commits.some(k => {
    if ((k.parents || []).length > 1) return false // a merge commit (main/epic into branch)
    const names = (k.files || []).map(f => (typeof f === 'string' ? f : f.filename))
    if (names.length && names.every(n => n.startsWith('writeups/ui-proposals/'))) return false // review captures
    const d = k.commit?.committer?.date || k.commit?.author?.date
    return d && new Date(d) > approvedAt
  })
  if (revised) return { go: false, reason: 'a commit landed after the approval — needs a fresh ok', approvedAt: verdict.at }
  return { go: true, reason: 'owner approved and nothing changed since', approvedAt: verdict.at }
}
