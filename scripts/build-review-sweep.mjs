/**
 * Safety-net sweep (#3218): which green pipeline PRs never got a build review?
 * At most ONE dispatch per head SHA. Handled for SHA X = a build-review-sha:X comment, a
 * build-review-sweep:X comment (already dispatched), or a build-review-failed comment
 * (failed-sha:X, or an unsigned one created after the head commit).
 */
import { isPipelinePr } from './build-review-pick.mjs'

const AGE_MS = 15 * 60 * 1000

export function needsReview({ pr, checks = [], comments = [], headCommitDate, now = Date.now() }) {
  if (!isPipelinePr(pr)) return false
  const sha = pr.headRefOid
  if (!sha) return false
  const gate = checks.filter((c) => c.name === 'CI Gate').sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0]
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') return false
  const done = Date.parse(gate.completed_at || '')
  if (!Number.isFinite(done) || now - done < AGE_MS) return false
  const headAt = Date.parse(headCommitDate || '')
  for (const c of comments) {
    const b = c.body || ''
    if (b.includes(`<!-- build-review-sha:${sha} -->`)) return false
    if (b.includes(`<!-- build-review-sweep:${sha} -->`)) return false
    if (b.includes(`<!-- build-review-failed-sha:${sha} -->`)) return false
    if (b.includes('<!-- build-review-failed -->') && !b.includes('<!-- build-review-failed-sha:') &&
        Number.isFinite(headAt) && Date.parse(c.created_at) > headAt) return false
  }
  return true
}
