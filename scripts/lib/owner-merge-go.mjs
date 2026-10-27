// owner-merge-go.mjs — has the owner said "go" on a held PR? (#2832)
//
// The owner's `ok` (or legacy `lgtm`/`approve`) on a PR held for a human IS the merge
// decision: once checks are green the pipeline merges it, so no second trip to tap Merge.
// Pure decision only — the workflow supplies the PR's comments and commits.
//
// Rules: the approval must be by the owner, a real user comment (not a 🤖-headed agent
// comment — `isApproval` enforces that), the owner's latest verdict must not be a later
// `not ok`, and no NON-MERGE commit may land after it (a worker revision needs a fresh
// `ok`; a plain "merge main/epic into branch" commit does not).

import { isApproval, parseTestReply } from '../approval.mjs'

/**
 * @param {{ comments: Array<{user?: {login?: string, type?: string}, body?: string, created_at: string}>,
 *           commits: Array<{parents?: unknown[], commit?: {committer?: {date?: string}, author?: {date?: string}}}>,
 *           owner: string }} input
 * @returns {{ go: boolean, reason: string, approvedAt?: string }}
 */
export function ownerMergeGo({ comments = [], commits = [], owner }) {
  const mine = comments
    .filter(c => c.user?.login?.toLowerCase() === String(owner).toLowerCase() && c.user?.type !== 'Bot')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  let verdict = null
  for (const c of mine) {
    if (isApproval(c.body)) verdict = { yes: true, at: c.created_at }
    else if (parseTestReply(c.body).result === 'not-ok') verdict = { yes: false, at: c.created_at }
  }
  if (!verdict) return { go: false, reason: 'no owner approval' }
  if (!verdict.yes) return { go: false, reason: 'owner replied not ok after the last approval' }

  const approvedAt = new Date(verdict.at)
  const revised = commits.some(k => {
    if ((k.parents || []).length > 1) return false // a merge commit (main/epic into branch)
    const d = k.commit?.committer?.date || k.commit?.author?.date
    return d && new Date(d) > approvedAt
  })
  if (revised) return { go: false, reason: 'a commit landed after the approval — needs a fresh ok', approvedAt: verdict.at }
  return { go: true, reason: 'owner approved and nothing changed since', approvedAt: verdict.at }
}
