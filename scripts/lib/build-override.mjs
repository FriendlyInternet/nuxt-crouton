// build-override.mjs — does the owner's `ok` override a build review that sent the PR back? (#3173)
//
// The merge workflow used to skip any PR without `build:approved` before it read the owner's
// `ok`, so an `ok` on a twice-rejected build was silently ignored. Pure decision only: the
// workflow supplies the PR's comments and commits.
//
// Returns { action: 'approve' } | { action: 'reply', reason } | { action: 'none' }.

import { ownerMergeGo } from './owner-merge-go.mjs'

const isFinal = (b) => b.includes('<!-- build-review-final -->') || b.includes('Build rejected twice')

export function decideBuildOverride({ comments = [], commits = [], owner }) {
  const states = comments
    .filter(c => /<!-- build-review-verdict:|<!-- build-review-failed -->/.test(c.body || '') || (c.body || '').includes('Build rejected twice'))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  const newest = states[states.length - 1]
  const go = ownerMergeGo({ comments, commits, owner })

  if (!go.go) {
    if (go.approvedAt) return { action: 'reply', reason: 'revised' }
    return { action: 'none' }
  }
  if (!newest) return { action: 'reply', reason: 'noverdict' }
  const body = newest.body || ''
  if (body.includes('<!-- build-review-failed -->')) return { action: 'reply', reason: 'failed' }
  if (!isFinal(body)) return { action: 'reply', reason: 'round1' }
  if (new Date(go.approvedAt) > new Date(newest.created_at)) return { action: 'approve' }
  return { action: 'reply', reason: 'stale-ok' }
}
