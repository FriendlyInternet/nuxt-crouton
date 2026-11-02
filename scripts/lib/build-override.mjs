// build-override.mjs — does the owner's `ok` override a build review that sent the PR back? (#3173)
//
// The merge workflow used to skip any PR without `build:approved` before it read the owner's
// `ok`, so an `ok` on a twice-rejected build was silently ignored. Pure decision only: the
// workflow supplies the PR's comments and commits.
//
// Returns { action: 'approve' } | { action: 'reply', reason } | { action: 'none' }.

import { ownerMergeGo } from './owner-merge-go.mjs'

// Pipeline bots allowed to post a build-review verdict (same list the merge evaluator uses).
export const BOTS = ['claude[bot]', 'nuxt-harness[bot]']
const isReviewBot = (u) => !!u && u.type === 'Bot' && BOTS.includes(u.login)

// Final hold = the marker, or (comments from before the marker) the FIRST heading line is the
// final head. Evidence text that merely quotes the phrase must not count.
const headLine = (b) => b.split('\n').find(l => /^(🔴|✅|🔀) \*\*/.test(l)) || ''
const isFinal = (b) => b.includes('<!-- build-review-final -->') || headLine(b).startsWith('🔴 **Build rejected twice**')

export function decideBuildOverride({ comments = [], commits = [], owner, reviewRunning = false }) {
  const states = comments
    .filter(c => isReviewBot(c.user))
    .filter(c => /<!-- build-review-verdict:|<!-- build-review-failed -->/.test(c.body || '') || isFinal(c.body || ''))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const newest = states[states.length - 1]
  const go = ownerMergeGo({ comments, commits, owner })

  if (!go.go) {
    if (go.approvedAt) return { action: 'reply', reason: 'revised' }
    return { action: 'none' }
  }
  if (!newest) return { action: 'reply', reason: reviewRunning ? 'running' : 'noverdict' }
  const body = newest.body || ''
  if (body.includes('<!-- build-review-failed -->')) return { action: 'reply', reason: reviewRunning ? 'running' : 'failed' }
  // A needs-owner verdict is a question to the owner — their ok answers it, same as after the final hold.
  const needsOwner = body.includes('<!-- build-review-verdict:needs-owner -->')
  // A go verdict with the label missing is not a "round 1" send-back — say what is actually wrong.
  if (body.includes('<!-- build-review-verdict:go -->')) return { action: 'reply', reason: 'go-nolabel' }
  if (!isFinal(body) && !needsOwner) return { action: 'reply', reason: 'round1' }
  if (new Date(go.approvedAt) > new Date(newest.created_at)) return { action: 'approve' }
  return { action: 'reply', reason: 'stale-ok' }
}
