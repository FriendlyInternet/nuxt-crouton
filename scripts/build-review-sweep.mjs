/**
 * Safety-net sweep (#3218): which green pipeline PRs never got a build review?
 * At most ONE dispatch per head SHA. Handled for SHA X = a build-review-sha:X comment, a
 * build-review-sweep:X comment (already dispatched), or a build-review-failed comment
 * (failed-sha:X, or an unsigned one created after the head commit).
 */
import { isPipelinePr } from './build-review-pick.mjs'

const AGE_MS = 15 * 60 * 1000

function latestGate(checks) {
  return checks
    .filter((c) => c.name === 'CI Gate')
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))[0]
}

function gateGreenAndOld(gate, now) {
  if (!gate || gate.status !== 'completed' || gate.conclusion !== 'success') return false
  const done = Date.parse(gate.completed_at || '')
  return Number.isFinite(done) && now - done >= AGE_MS
}

function isHandled(body, sha, createdAt, headAt) {
  if (body.includes(`<!-- build-review-sha:${sha} -->`)) return true
  if (body.includes(`<!-- build-review-sweep:${sha} -->`)) return true
  if (body.includes(`<!-- build-review-failed-sha:${sha} -->`)) return true
  const unsignedFailure = body.includes('<!-- build-review-failed -->') &&
    !body.includes('<!-- build-review-failed-sha:')
  return unsignedFailure && Number.isFinite(headAt) && Date.parse(createdAt) > headAt
}

export function needsReview({ pr, checks = [], comments = [], headCommitDate, now = Date.now() }) {
  const sha = pr.headRefOid
  if (!isPipelinePr(pr) || !sha) return false
  if (!gateGreenAndOld(latestGate(checks), now)) return false
  const headAt = Date.parse(headCommitDate || '')
  return !comments.some((c) => isHandled(c.body || '', sha, c.created_at, headAt))
}
